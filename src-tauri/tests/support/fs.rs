use std::fs;
use std::path::Path;

pub fn write_file(root: &Path, rel: &str, contents: &str) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(&p, contents).expect("write file");
}

pub fn append_file(root: &Path, rel: &str, extra: &str) {
    let p = root.join(rel);
    let mut existing = fs::read_to_string(&p).unwrap_or_default();
    existing.push_str(extra);
    fs::write(&p, existing).expect("append file");
}

pub fn read_file(root: &Path, rel: &str) -> String {
    fs::read_to_string(root.join(rel)).expect("read file")
}
