//! User-defined commands (#225) — mostly about what a user's data CANNOT do.
//!
//! The tempting implementation of this feature is `sh -c "<the string>"`, and it
//! is wrong in a way that stays invisible until it bites: under a shell, a
//! branch named `main; rm -rf ~` or a path containing `$(...)` stops being data
//! and becomes code. Branch names and paths come from the repository, which
//! means they can come from anyone who has ever pushed to it.
//!
//! So the load-bearing property, asserted from several directions below, is:
//! **a substituted value can never introduce a new argument.**

use platypusgit_lib::custom_action::{
    build_argv, parse_command, substitute, truncate_output, ActionContext, MAX_OUTPUT_BYTES,
};
use platypusgit_lib::error::AppError;

fn ctx() -> ActionContext {
    ActionContext {
        repo: "/repo".to_string(),
        files: vec!["src/a.rs".to_string()],
        sha: Some("abc123".to_string()),
        branch: Some("main".to_string()),
    }
}

fn parse(line: &str) -> Vec<String> {
    parse_command(line).expect("should parse")
}

fn refusal(line: &str) -> String {
    match parse_command(line) {
        Err(AppError::InvalidArgument(m)) => m,
        other => panic!("expected InvalidArgument for {line:?}, got {other:?}"),
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Parsing: quotes group, nothing else is special
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn splits_on_whitespace() {
    assert_eq!(parse("code -g file"), vec!["code", "-g", "file"]);
    assert_eq!(parse("  code   -g  "), vec!["code", "-g"]);
    assert_eq!(parse("code\t-g\nfile"), vec!["code", "-g", "file"]);
}

#[test]
fn quotes_group_arguments() {
    assert_eq!(
        parse(r#"code "my file.txt""#),
        vec!["code", "my file.txt"]
    );
    assert_eq!(parse("code 'my file.txt'"), vec!["code", "my file.txt"]);
    // Adjacent quoting concatenates, the way a shell does.
    assert_eq!(parse(r#"a "b"c"#), vec!["a", "bc"]);
    // An empty quoted string IS an argument.
    assert_eq!(parse(r#"foo "" bar"#), vec!["foo", "", "bar"]);
}

#[test]
fn backslash_escapes_outside_single_quotes() {
    assert_eq!(parse(r"code my\ file"), vec!["code", "my file"]);
    assert_eq!(parse(r#"code "a\"b""#), vec!["code", r#"a"b"#]);
    // Inside single quotes a backslash is literal, so a Windows path survives.
    assert_eq!(parse(r"code 'C:\Users\me'"), vec!["code", r"C:\Users\me"]);
}

#[test]
fn shell_operators_are_ORDINARY_CHARACTERS() {
    // Nothing interprets them, so they can only ever be text in an argument.
    // This is the property that makes the whole feature safe.
    assert_eq!(
        parse("echo a;rm -rf /"),
        vec!["echo", "a;rm", "-rf", "/"],
        "a semicolon does not start a second command",
    );
    assert_eq!(parse("echo a|b"), vec!["echo", "a|b"]);
    assert_eq!(parse("echo a>b"), vec!["echo", "a>b"]);
    assert_eq!(parse("echo a&&b"), vec!["echo", "a&&b"]);
    assert_eq!(parse("echo $(whoami)"), vec!["echo", "$(whoami)"]);
    assert_eq!(parse("echo `whoami`"), vec!["echo", "`whoami`"]);
    assert_eq!(parse("echo *"), vec!["echo", "*"], "no globbing");
    assert_eq!(parse("echo ~"), vec!["echo", "~"], "no tilde expansion");
    assert_eq!(parse("echo $HOME"), vec!["echo", "$HOME"], "no env expansion");
}

#[test]
fn refuses_what_it_cannot_parse() {
    assert!(refusal(r#"code "unclosed"#).contains("unclosed quote"));
    assert!(refusal("code 'unclosed").contains("unclosed quote"));
    assert!(refusal(r"code trailing\").contains("trailing backslash"));
    assert!(refusal("").contains("empty"));
    assert!(refusal("   ").contains("empty"));
}

// ───────────────────────────────────────────────────────────────────────────
// Substitution: into individual entries, never creating new ones
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn substitutes_the_documented_placeholders() {
    let argv = substitute(
        &parse("tool $REPO $FILE $SHA $BRANCH"),
        &ctx(),
    );
    assert_eq!(argv, vec!["tool", "/repo", "src/a.rs", "abc123", "main"]);
}

#[test]
fn substitutes_inside_a_larger_argument() {
    let argv = substitute(&parse("tool --repo=$REPO/sub"), &ctx());
    assert_eq!(argv, vec!["tool", "--repo=/repo/sub"]);
}

#[test]
fn a_value_containing_a_space_stays_ONE_argument() {
    // The property the whole design exists for. Splitting already happened in
    // `parse_command`; nothing re-splits afterwards.
    let mut c = ctx();
    c.files = vec!["my file.txt".to_string()];
    let argv = substitute(&parse("tool $FILE"), &c);
    assert_eq!(argv, vec!["tool", "my file.txt"]);
    assert_eq!(argv.len(), 2, "still two arguments, not three");
}

#[test]
fn a_branch_name_with_shell_metacharacters_is_inert() {
    // Branch names come from the repository, which means from anyone who has
    // ever pushed to it. Under `sh -c` this would be a second command.
    let mut c = ctx();
    c.branch = Some("main; rm -rf ~".to_string());
    let argv = substitute(&parse("tool $BRANCH"), &c);
    assert_eq!(argv, vec!["tool", "main; rm -rf ~"]);
    assert_eq!(argv.len(), 2);
}

#[test]
fn command_substitution_in_a_value_is_inert() {
    let mut c = ctx();
    c.branch = Some("$(whoami)".to_string());
    c.files = vec!["`id`".to_string()];
    let argv = substitute(&parse("tool $BRANCH $FILE"), &c);
    assert_eq!(argv, vec!["tool", "$(whoami)", "`id`"]);
}

#[test]
fn a_substituted_value_is_not_itself_re_scanned_for_placeholders() {
    // A file literally named `$SHA` must not pull in the sha. Values are data.
    let mut c = ctx();
    c.files = vec!["$SHA".to_string()];
    let argv = substitute(&parse("tool $FILE"), &c);
    assert_eq!(
        argv,
        vec!["tool", "$SHA"],
        "the substituted text is final, not another template",
    );
}

#[test]
fn an_absent_value_becomes_an_empty_argument_not_a_literal_placeholder() {
    // Handing a program the four characters `$SHA` would be worse: it looks
    // like a real argument and fails somewhere further away.
    let c = ActionContext {
        repo: "/repo".to_string(),
        files: vec![],
        sha: None,
        branch: None,
    };
    let argv = substitute(&parse("tool $SHA $BRANCH $FILE"), &c);
    assert_eq!(argv, vec!["tool", "", "", ""]);
}

#[test]
fn files_expands_to_one_argument_per_file() {
    let mut c = ctx();
    c.files = vec![
        "a.rs".to_string(),
        "my file.txt".to_string(),
        "c;d.rs".to_string(),
    ];
    let argv = substitute(&parse("tool $FILES"), &c);
    assert_eq!(argv, vec!["tool", "a.rs", "my file.txt", "c;d.rs"]);
    assert_eq!(argv.len(), 4, "whole entries, never a split string");
}

#[test]
fn files_with_no_selection_expands_to_nothing() {
    let mut c = ctx();
    c.files = vec![];
    assert_eq!(substitute(&parse("tool $FILES"), &c), vec!["tool"]);
}

#[test]
fn files_inside_a_larger_argument_joins_rather_than_splitting() {
    // `--files=$FILES` cannot become several arguments, so joining is the
    // least surprising reading — and it is still ONE argument.
    let mut c = ctx();
    c.files = vec!["a.rs".to_string(), "b.rs".to_string()];
    let argv = substitute(&parse("tool --files=$FILES"), &c);
    assert_eq!(argv, vec!["tool", "--files=a.rs b.rs"]);
}

// ───────────────────────────────────────────────────────────────────────────
// build_argv
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn file_is_a_prefix_of_files_and_the_longer_one_wins() {
    // The bug this pins: matching `$FILE` inside `$FILES` leaves a stray `S`.
    // `placeholders()` sorts by descending name length so the ordering is
    // structural rather than something the next placeholder has to remember.
    let mut c = ctx();
    c.files = vec!["a.rs".to_string(), "b.rs".to_string()];
    assert_eq!(
        substitute(&parse("tool x$FILESy"), &c),
        vec!["tool", "xa.rs b.rsy"],
        "`$FILES` must not be read as `$FILE` followed by an S",
    );
}

#[test]
fn build_argv_runs_the_whole_pipeline() {
    let argv = build_argv("code -g $FILE", &ctx()).unwrap();
    assert_eq!(argv, vec!["code", "-g", "src/a.rs"]);
}

#[test]
fn build_argv_refuses_an_empty_program_after_substitution() {
    // `$FILE` as the program with nothing selected. Spawning "" is a confusing
    // OS error; this is a clear one.
    let c = ActionContext {
        repo: "/repo".to_string(),
        files: vec![],
        sha: None,
        branch: None,
    };
    let err = build_argv("$FILE --flag", &c).unwrap_err();
    assert!(
        matches!(&err, AppError::InvalidArgument(m) if m.contains("program name")),
        "got {err:?}",
    );
}

#[test]
fn build_argv_propagates_a_parse_refusal() {
    assert!(matches!(
        build_argv(r#"code "unclosed"#, &ctx()),
        Err(AppError::InvalidArgument(_))
    ));
}

// ───────────────────────────────────────────────────────────────────────────
// Output
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn output_is_truncated_with_a_marker_rather_than_silently() {
    let big = "x".repeat(MAX_OUTPUT_BYTES + 1000);
    let out = truncate_output(big);
    assert!(out.len() < MAX_OUTPUT_BYTES + 100);
    assert!(
        out.ends_with("output truncated"),
        "the panel must never imply it showed everything",
    );
}

#[test]
fn short_output_is_untouched() {
    assert_eq!(truncate_output("hello".to_string()), "hello");
}
