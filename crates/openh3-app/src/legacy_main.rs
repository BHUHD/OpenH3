//! Compatibility binary for existing OpenH3 installations and scripts.
//!
//! The canonical executable is `openh3-core`; this shim intentionally keeps
//! the historical `aioncore` filename available without changing its runtime
//! protocol or data-directory contract.

include!("main.rs");
