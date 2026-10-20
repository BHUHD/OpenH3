use super::*;
use crate::canonical::canonicalize;

#[cfg(windows)]
const ROOT_URI: &str = "file:///C:/work/proj";
#[cfg(not(windows))]
const ROOT_URI: &str = "file:///work/proj";

fn root() -> Canonical {
    canonicalize(ROOT_URI).unwrap()
}

#[test]
fn resolves_normal_child_path() {
    let r = resolve_relative(&root(), "src/main.rs", FileOp::Read).unwrap();
    assert_eq!(r.relative_path, "src/main.rs");
    assert_eq!(r.resource_uri, format!("{ROOT_URI}/src/main.rs"));
    let expected = if cfg!(windows) {
        PathBuf::from(r"c:\work\proj\src\main.rs")
    } else {
        PathBuf::from("/work/proj/src/main.rs")
    };
    assert_eq!(r.absolute_path.unwrap(), expected);
}

#[test]
fn empty_relative_is_root_itself() {
    let r = resolve_relative(&root(), "", FileOp::Browse).unwrap();
    assert_eq!(r.relative_path, "");
    assert_eq!(r.resource_uri, ROOT_URI);
}

#[test]
fn strips_single_dot_and_trailing_slash() {
    let r = resolve_relative(&root(), "./a/b/", FileOp::Read).unwrap();
    assert_eq!(r.relative_path, "a/b");
}

#[test]
fn interior_dot_dot_that_stays_inside_is_ok() {
    let r = resolve_relative(&root(), "a/../b", FileOp::Read).unwrap();
    assert_eq!(r.relative_path, "b");
}

#[test]
fn absolute_path_is_rejected() {
    let err = resolve_relative(&root(), "/etc/passwd", FileOp::Read).unwrap_err();
    assert_eq!(err.code(), "invalid_relative_path");
}

#[test]
fn dot_dot_escape_is_rejected() {
    assert_eq!(
        resolve_relative(&root(), "..", FileOp::Read).unwrap_err().code(),
        "invalid_relative_path"
    );
    assert_eq!(
        resolve_relative(&root(), "a/../../b", FileOp::Read).unwrap_err().code(),
        "invalid_relative_path"
    );
}
