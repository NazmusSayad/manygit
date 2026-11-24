# manygit

manygit shows all the git repositories in a folder in one terminal screen. You can do git tasks on one repository or on many repositories at the same time.

- See the branch and the status of each repository.
- Fetch, pull, push, and change branches in many repositories at the same time.
- Make commits, pull requests, and releases with text that AI writes. manygit uses [gityo](https://github.com/NazmusSayad/gityo) for this.

![manygit demo](assets/demo.gif)

## Install

```bash
npm install -g manygit
```

## Start

To show the repositories in the current folder, type:

```bash
manygit
```

To show the repositories in a different folder, type the folder path:

```bash
manygit ~/code
```

## Select the repositories

An action applies to one of these:

- The repository at the cursor.
- The repositories that you select with `space`.
- All the repositories, when the cursor is not on a repository.

## Keys

| Key       | Action                                                     |
| --------- | ---------------------------------------------------------- |
| `enter`   | Make a commit. AI writes the commit message.               |
| `f`       | Get the new changes from the remote. Do not merge them.    |
| `p`       | Pull. This applies only if your branch has no new commits. |
| `P`       | Push. If the branch has no upstream, manygit sets it.      |
| `c`       | Change to a different branch, local or remote.             |
| `C`       | Make a new branch and change to it.                        |
| `X`       | Delete all the local branches except current branch.       |
| `o`       | Make or merge a pull request. AI writes the text.          |
| `R`       | Publish a GitHub release. AI writes the release notes.     |
| `w`       | Open the remote in the browser.                            |
| `r`       | Get the status again.                                      |
| `s`       | Change the sort order.                                     |
| `space`   | Select or clear the repository.                            |
| `↑` `↓`   | Move the cursor.                                           |
| `esc`     | Go back one step.                                          |
| `?` / `/` | Show all the commands.                                     |
| `q`       | Quit.                                                      |

When you change to a remote branch, manygit makes a local branch with the same name that tracks the remote branch.

Some actions can fail because of a problem that manygit can repair. For example, you have local changes, or the remote rejects a push. In these conditions, manygit shows the possible repairs, and you select one.

## AI features

Commits, pull requests, and releases use gityo and its configuration. Before you use these features, set up an AI model. Do the steps in the [gityo README](https://github.com/NazmusSayad/gityo#setup).

Pull requests and releases also need the [GitHub CLI](https://cli.github.com) (`gh`). You must sign in to `gh`.

## Exclude folders

To skip folders when manygit looks for repositories, put a `.manygit.json` file in the folder that you open:

```json
{
  "$schema": "https://github.com/NazmusSayad/manygit/raw/refs/heads/schema/schema.json",
  "exclude": ["archive", "**/vendor", "old-*"]
}
```

Each item is a glob pattern. manygit compares it to the folder path from the opened folder, with `/` between the parts. For example, `archive` skips only the `archive` folder at the top, and `**/vendor` skips each `vendor` folder at any depth. manygit does not look inside a skipped folder.

manygit also skips hidden folders, which are folders with a name that starts with `.`. To include them, add `"includeHidden": true`.

The `$schema` line is optional. With it, your editor can complete and check the settings. To make a `.manygit.json` file that has only this line, type `manygit init`. To make it in a different folder, type `manygit init <folder>`.

## Saved settings

For each folder, manygit keeps these settings:

- The repositories that you selected.
- The sort order.
- The repository at the cursor when you quit.

manygit keeps these settings in `~/.manygit/state.json`. To use a different location, use `--store-dir <dir>`.
