@rem The `pgit` entry point that ships INSIDE platypusgit_x64_portable.zip, the
@rem asset the Scoop bucket installs (#187).
@rem
@rem WHY IT IS RELATIVE where cli.rs::shim_cmd_body writes an absolute path: a
@rem file inside a zip cannot know where it will be extracted, and Scoop keeps
@rem the live version behind a `current` junction that it re-points on every
@rem update -- so an absolute path would be wrong the first time the package is
@rem upgraded, in a way nothing would report. `%~dp0` is this file's own
@rem directory, trailing backslash included.
@rem
@rem WHY IT MUST EXIST AT ALL: cli.rs::shim_status probes `exe_dir/pgit.cmd`
@rem before it scans PATH, and this file is what makes a Scoop install classify
@rem as `CliShimSource::Package` -- which is what stops Settings offering to write
@rem a second, competing shim into %LOCALAPPDATA% that Scoop would neither know
@rem about nor remove. cli.rs::PORTABLE_SHIM_CMD includes these bytes and a test
@rem pins that classification, so deleting or renaming this file fails the build
@rem rather than quietly un-shimming Windows.
@rem
@rem The `@rem` prefix keeps these lines out of the console the same way `@echo
@rem off` does for what follows.
@echo off
"%~dp0platypusgit.exe" %*
