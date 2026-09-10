"""Rewrite vendored LayerZero Cargo.toml files so each crate resolves exactly one
copy of every sibling crate (path deps) and pins soroban-sdk 25.1.1.

Usage: vendor_rewrite.py <vendor_dir> <crates_dir>
  vendor_dir crates get siblings at ../<name>; crates_dir crates at ../../vendor/<name>.
"""
import os
import re
import sys

vendor, crates = sys.argv[1], sys.argv[2]

# npm-style dependency dir -> vendored crate dir name
NAMES = {
    "common-utils-macros-stellar-contracts": "common-macros",
    "common-utils-stellar-contracts": "utils",
    "protocol-stellar-v2/endpoint-v2": "endpoint-v2",
    "oapp-macros-stellar-contracts": "oapp-macros",
    "oapp-stellar-contracts": "oapp",
    "oft-core-stellar-contracts": "oft-core",
}
SDK = '{ version = "=25.1.1", features = ["hazmat-address", "hazmat-crypto"] }'


def fix(path: str, prefix: str) -> None:
    s = open(path).read()
    for a, b in NAMES.items():
        s = s.replace(f'path = "dependencies/{a}"', f'path = "{prefix}{b}"')
    # crates that inherit from the monorepo workspace: `x = { workspace = true }`
    inline = {
        "soroban-sdk": SDK,
        "soroban-sdk-macros": '"=25.1.1"',
        "cfg-if": '{ version = "1.0", default-features = false }',
        "utils": f'{{ path = "{prefix}utils" }}',
        "common-macros": f'{{ path = "{prefix}common-macros" }}',
        "endpoint-v2": f'{{ path = "{prefix}endpoint-v2", default-features = false, features = ["library"] }}',
        "oapp": f'{{ path = "{prefix}oapp" }}',
        "oapp-macros": f'{{ path = "{prefix}oapp-macros" }}',
        "oft-core": f'{{ path = "{prefix}oft-core" }}',
    }
    for dep, val in inline.items():
        s = re.sub(rf"^{re.escape(dep)}\s*=\s*\{{\s*workspace\s*=\s*true(?:\s*,[^}}]*)?\s*\}}", f"{dep} = {val}", s, flags=re.M)
    # drop dev-dependencies (tests are not vendored)
    s = re.split(r"\n\[dev-dependencies\]", s)[0].rstrip() + "\n"
    # package fields inherited from the workspace
    fields = {
        "version": 'version = "0.0.1"',
        "edition": 'edition = "2021"',
        "publish": "publish = false",
        "license": 'license = "MIT"',
        "rust-version": 'rust-version = "1.90.0"',
        "repository": '# repository dropped',
        "authors": '# authors dropped',
    }
    s = re.sub(r"([\w-]+)\.workspace\s*=\s*true", lambda m: fields.get(m.group(1), f"# dropped {m.group(1)}.workspace"), s)
    s = re.sub(r'soroban-sdk = \{ version = "25\.1\.1"', 'soroban-sdk = { version = "=25.1.1"', s)
    if "[workspace]" not in s:
        s += "\n[workspace]\n"
    open(path, "w").write(s)
    print("rewrote", os.path.relpath(path))


for d in os.listdir(vendor):
    p = os.path.join(vendor, d, "Cargo.toml")
    if os.path.exists(p):
        fix(p, "../")
for d in os.listdir(crates):
    p = os.path.join(crates, d, "Cargo.toml")
    if os.path.exists(p):
        fix(p, "../../vendor/")
