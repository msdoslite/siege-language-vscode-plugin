# Siege Language Tools

VS Code language support for Dungeon Siege, Legends of Aranna, Dungeon Siege II, and Space Siege.

## Features

- Syntax highlighting for GAS, Skrit, Flick, Naming Key (`.nnk`), `$required`, and `startup_verify.gpg`.
- Workspace diagnostics for unopened files, automatically refreshed after edits.
- Completion, hover, definition and reference navigation, rename, signature help, folding, snippets, and document symbols.
- Separate game profiles and per-folder configuration in multi-root workspaces.

## Game profiles

**Select the profile that matches your game before editing.** Dungeon Siege (DS), Dungeon Siege II (DS2), and Space Siege (SS) use different syntax rules. An incorrect profile can produce false syntax errors or miss constructs specific to another game.

| Game | Profile (`siege.profile`) |
| --- | --- |
| Dungeon Siege (DS), including Legends of Aranna (LoA) | `dsloa` |
| Dungeon Siege II (DS2), including Broken World | `ds2` |
| Space Siege (SS) | `space-siege` |

The default profile is **DS / LoA (`dsloa`)**. Profiles are **not detected automatically** from folder names or file extensions.

Open a file in your project and run **Siege: Select Game Profile** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), or use a direct command:

- **Siege: Use DSLOA / Dungeon Siege Profile** — DS / LoA.
- **Siege: Use Dungeon Siege II Profile** — DS2.
- **Siege: Use Space Siege Profile** — SS.

The selected profile is saved for the active file's workspace folder. Diagnostics are automatically rechecked after switching; no restart is required. In multi-root workspaces, each folder can use its own profile. Without an active root, the command asks which folder to change. With no workspace open, it updates user settings.

If you work with several games, open their projects separately or add them as separate workspace folders and select the appropriate profile for each. A single workspace folder uses one profile for all its files, including subfolders.

## Settings

- `siege.profile`: `dsloa`, `ds2`, or `space-siege`.
- `siege.indexWorkspace`: index unopened files (default: true).
- `siege.exclude`: project paths to exclude.
- `siege.maxFileSizeKB`: file size limit (default: 4096).
- `siege.conditions`: conditional Skrit compilation flags. DS2 defaults include `retail=true`, `dev=false`; override both flags to switch branches.
- `siege.diagnostics.duplicateProperties`: optional repeated-property warnings (default: off). Repeated GAS properties and `*` list entries are allowed.

Run **Siege: Reindex Workspace** to rescan manually or **Siege: Show Analysis Log** for indexing details.

## Limitations

Diagnostics distinguish canonical editor syntax from permissive engine recovery. Shipped game files can contain errors. Unknown engine APIs are not treated as invalid merely because they are unknown. This extension is not a full game compiler or runtime: API/schema validation, cross-file compilation, and embedded expression checking remain incomplete.

The extension has no runtime npm dependencies, makes no network requests, and does not run game executables. It targets desktop VS Code and the Node-based remote Extension Host, not browser-only VS Code.

## License

[MIT](LICENSE).
