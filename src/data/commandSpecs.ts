/**
 * Fig-style command specifications for autocomplete.
 * Inline data, no external API.
 */

export interface FlagSpec {
  name: string;
  short?: string;
  description: string;
  takesValue?: boolean;
  repeatable?: boolean;
}

export interface ArgSpec {
  name: string;
  template?: 'file' | 'folder' | 'command';
  suggestions?: string[];
}

export interface SubcommandSpec {
  name: string;
  description: string;
  flags?: FlagSpec[];
  args?: ArgSpec[];
  subcommands?: SubcommandSpec[];
}

export interface CommandSpec {
  name: string;
  description: string;
  flags?: FlagSpec[];
  args?: ArgSpec[];
  subcommands?: SubcommandSpec[];
}

const GIT_SUBCOMMANDS: SubcommandSpec[] = [
  // ── Most common operations first ──
  { name: 'commit', description: 'Record changes to repository', flags: [
    { name: 'message', short: 'm', description: 'Commit message', takesValue: true },
    { name: 'amend', description: 'Amend previous commit' },
    { name: 'no-verify', description: 'Skip pre-commit hooks' },
    { name: 'all', short: 'a', description: 'Stage all changed files' },
  ]},
  { name: 'push', description: 'Update remote refs', args: [{ name: 'remote' }, { name: 'branch' }], flags: [
    { name: 'force-with-lease', description: 'Force push (safer)' },
    { name: 'force', short: 'f', description: 'Force push' },
    { name: 'set-upstream', short: 'u', description: 'Set upstream tracking branch' },
    { name: 'delete', short: 'd', description: 'Delete remote branch', takesValue: true },
  ]},
  { name: 'pull', description: 'Fetch and integrate with remote', flags: [
    { name: 'rebase', description: 'Rebase local commits on top of upstream' },
    { name: 'ff-only', description: 'Fast-forward only' },
  ]},
  { name: 'checkout', description: 'Switch branches or restore files', args: [{ name: 'branch', suggestions: ['main', 'master', 'develop', 'staging'] }, { name: 'path', template: 'file' }], flags: [
    { name: 'b', description: 'Create new branch and switch to it', takesValue: false },
  ]},
  { name: 'add', description: 'Stage file changes', args: [{ name: 'path', template: 'file', suggestions: ['.', './'] }] },
  { name: 'status', description: 'Show working tree status', flags: [
    { name: 'short', short: 's', description: 'Short output format' },
    { name: 'branch', short: 'b', description: 'Show branch info' },
  ]},
  { name: 'diff', description: 'Show changes between commits', args: [{ name: 'path', template: 'file' }], flags: [
    { name: 'cached', short: 'staged', description: 'Show staged changes' },
    { name: 'name-only', description: 'Show only filenames' },
    { name: 'stat', description: 'Show diffstat' },
  ]},
  { name: 'log', description: 'Show commit logs', flags: [
    { name: 'oneline', description: 'Compact one-line per commit' },
    { name: 'graph', description: 'Draw ASCII graph' },
    { name: 'max-count', short: 'n', description: 'Limit number of commits', takesValue: true },
    { name: 'all', description: 'Show all refs' },
  ]},
  // ── Less common / advanced ──
  { name: 'branch', description: 'List, create, or delete branches', flags: [
    { name: 'delete', short: 'd', description: 'Delete a branch' },
    { name: 'all', short: 'a', description: 'List both remote and local branches' },
    { name: 'remote', short: 'r', description: 'List remote branches' },
  ]},
  { name: 'fetch', description: 'Download objects from remote', flags: [
    { name: 'all', description: 'Fetch all remotes' },
    { name: 'prune', description: 'Remove stale remote refs' },
  ]},
  { name: 'merge', description: 'Merge branches together', args: [{ name: 'branch' }] },
  { name: 'rebase', description: 'Reapply commits on top of another base', args: [{ name: 'branch' }], flags: [
    { name: 'interactive', short: 'i', description: 'Interactive rebase' },
    { name: 'continue', description: 'Continue after conflict resolution' },
    { name: 'abort', description: 'Abort rebase' },
  ]},
  { name: 'reset', description: 'Reset current HEAD to specified state', args: [{ name: 'commit' }], flags: [
    { name: 'hard', description: 'Discard all changes' },
    { name: 'soft', description: 'Keep changes staged' },
    { name: 'mixed', description: 'Keep changes unstaged (default)' },
  ]},
  { name: 'restore', description: 'Restore working tree files', args: [{ name: 'path', template: 'file' }], flags: [
    { name: 'staged', short: 'S', description: 'Restore staged files' },
    { name: 'source', description: 'Which tree to restore from', takesValue: true },
  ]},
  { name: 'rm', description: 'Remove files from working tree', args: [{ name: 'path', template: 'file' }], flags: [
    { name: 'cached', description: 'Only remove from index' },
    { name: 'recursive', short: 'r', description: 'Recursive removal' },
    { name: 'force', short: 'f', description: 'Force removal' },
  ]},
  { name: 'switch', description: 'Switch to a branch', args: [{ name: 'branch' }], flags: [
    { name: 'create', short: 'c', description: 'Create new branch' },
    { name: 'detach', description: 'Detach HEAD at commit' },
  ]},
  { name: 'stash', description: 'Stash changes in a dirty worktree', subcommands: [
    { name: 'pop', description: 'Apply and remove top stash' },
    { name: 'drop', description: 'Drop a stash entry' },
    { name: 'list', description: 'List stash entries' },
    { name: 'show', description: 'Show stash contents' },
    { name: 'push', description: 'Push new stash', flags: [
      { name: 'message', short: 'm', description: 'Stash message', takesValue: true },
      { name: 'include-untracked', short: 'u', description: 'Include untracked files' },
    ]},
  ]},
  { name: 'tag', description: 'Create, list, delete or verify tags', flags: [
    { name: 'annotate', short: 'a', description: 'Annotated tag', takesValue: true },
    { name: 'delete', short: 'd', description: 'Delete tags' },
    { name: 'list', short: 'l', description: 'List tags' },
  ]},
];

const NPM_SUBCOMMANDS: SubcommandSpec[] = [
  // ── Most common operations first ──
  { name: 'install', description: 'Install packages', flags: [
    { name: 'save-dev', short: 'D', description: 'Save as dev dependency' },
    { name: 'save-peer', description: 'Save as peer dependency' },
    { name: 'global', short: 'g', description: 'Install globally' },
    { name: 'force', description: 'Force reinstall' },
  ], args: [{ name: 'package' }] },
  { name: 'run', description: 'Run a script', args: [{ name: 'script' }] },
  { name: 'test', description: 'Run tests' },
  { name: 'build', description: 'Build the package' },
  { name: 'update', description: 'Update packages', flags: [
    { name: 'global', short: 'g', description: 'Update global packages' },
  ]},
  { name: 'uninstall', description: 'Remove packages', args: [{ name: 'package' }] },
  { name: 'init', description: 'Create package.json' },
  // ── Less common ──
  { name: 'publish', description: 'Publish package to registry', flags: [
    { name: 'tag', description: 'Distribution tag', takesValue: true },
    { name: 'access', description: 'Access level (public/restricted)', takesValue: true },
  ]},
  { name: 'audit', description: 'Check for vulnerabilities', flags: [
    { name: 'fix', description: 'Auto-fix vulnerabilities' },
  ]},
  { name: 'ls', description: 'List installed packages', flags: [
    { name: 'depth', short: 'd', description: 'Max display depth', takesValue: true },
    { name: 'global', short: 'g', description: 'Global packages' },
  ]},
];

const BUN_SUBCOMMANDS: SubcommandSpec[] = [
  { name: 'install', description: 'Install dependencies' },
  { name: 'run', description: 'Run a script', args: [{ name: 'script' }] },
  { name: 'add', description: 'Add a dependency', args: [{ name: 'package' }], flags: [
    { name: 'dev', short: 'd', description: 'Dev dependency' },
    { name: 'global', short: 'g', description: 'Global install' },
  ]},
  { name: 'remove', description: 'Remove a dependency', args: [{ name: 'package' }] },
  { name: 'update', description: 'Update dependencies' },
  { name: 'test', description: 'Run tests' },
  { name: 'build', description: 'Build project' },
  { name: 'x', description: 'Run a package binary', args: [{ name: 'binary' }] },
  { name: 'pm', description: 'Package manager operations', subcommands: [
    { name: 'cache', description: 'Cache management' },
    { name: 'ls', description: 'List installed packages' },
    { name: 'bin', description: 'Manage bin links' },
  ]},
];

const CARGO_SUBCOMMANDS: SubcommandSpec[] = [
  // ── Most common operations first ──
  { name: 'build', description: 'Compile current package', flags: [
    { name: 'release', description: 'Build in release mode' },
    { name: 'verbose', short: 'v', description: 'Verbose output', repeatable: true },
    { name: 'target', description: 'Target triple', takesValue: true },
  ]},
  { name: 'run', description: 'Run compiled binary', flags: [
    { name: 'release', description: 'Run release build' },
    { name: 'example', description: 'Run example', takesValue: true },
  ]},
  { name: 'test', description: 'Run tests', flags: [
    { name: 'release', description: 'Run in release mode' },
    { name: 'verbose', short: 'v', description: 'Verbose output', repeatable: true },
    { name: 'no-run', description: 'Compile but do not run' },
  ]},
  { name: 'check', description: 'Check without emitting code', flags: [
    { name: 'verbose', short: 'v', description: 'Verbose output', repeatable: true },
  ]},
  { name: 'add', description: 'Add dependency', args: [{ name: 'crate' }], flags: [
    { name: 'dev', description: 'Dev dependency' },
    { name: 'build', description: 'Build dependency' },
    { name: 'features', description: 'Features to enable', takesValue: true },
  ]},
  { name: 'remove', description: 'Remove dependency', args: [{ name: 'crate' }] },
  // ── Less common / tooling ──
  { name: 'clippy', description: 'Lint checks', flags: [
    { name: 'fix', description: 'Auto-fix warnings' },
    { name: 'warnings', short: 'W', description: 'Set lint level', takesValue: true, repeatable: true },
  ]},
  { name: 'fmt', description: 'Format code', flags: [
    { name: 'check', description: 'Check formatting without modifying' },
    { name: 'all', description: 'Format all packages' },
  ]},
  { name: 'clean', description: 'Remove build artifacts', flags: [
    { name: 'release', description: 'Clean release artifacts only' },
    { name: 'doc', description: 'Clean doc artifacts' },
  ]},
  { name: 'doc', description: 'Build documentation', flags: [
    { name: 'open', description: 'Open docs in browser' },
    { name: 'no-deps', description: 'Do not build deps' },
  ]},
];

const DOCKER_SUBCOMMANDS: SubcommandSpec[] = [
  // ── Most common operations first ──
  { name: 'run', description: 'Run a container', flags: [
    { name: 'interactive', short: 'it', description: 'Interactive mode' },
    { name: 'detach', short: 'd', description: 'Detached mode' },
    { name: 'rm', description: 'Automatically remove container when it exits' },
    { name: 'publish', short: 'p', description: 'Publish port', takesValue: true },
    { name: 'volume', short: 'v', description: 'Bind mount volume', takesValue: true },
    { name: 'env', short: 'e', description: 'Environment variable', takesValue: true },
    { name: 'name', description: 'Container name', takesValue: true },
    { name: 'entrypoint', description: 'Overwrite default ENTRYPOINT', takesValue: true },
  ]},
  { name: 'build', description: 'Build an image from Dockerfile', args: [{ name: 'path', template: 'folder' }], flags: [
    { name: 'tag', short: 't', description: 'Name and optionally tag image', takesValue: true },
    { name: 'file', short: 'f', description: 'Path to Dockerfile', takesValue: true },
  ]},
  { name: 'ps', description: 'List containers', flags: [
    { name: 'all', short: 'a', description: 'Show all containers' },
    { name: 'quiet', short: 'q', description: 'Only show numeric IDs' },
    { name: 'format', description: 'Format output', takesValue: true },
  ]},
  // ── Less common ──
  { name: 'images', description: 'List images', flags: [
    { name: 'quiet', short: 'q', description: 'Only show image IDs' },
  ]},
  { name: 'exec', description: 'Execute command in running container', args: [{ name: 'container' }], flags: [
    { name: 'interactive', short: 'it', description: 'Interactive mode' },
  ]},
  { name: 'stop', description: 'Stop containers', args: [{ name: 'container' }] },
  { name: 'start', description: 'Start stopped containers', args: [{ name: 'container' }] },
  { name: 'rm', description: 'Remove containers', args: [{ name: 'container' }], flags: [
    { name: 'force', short: 'f', description: 'Force removal' },
  ]},
  { name: 'rmi', description: 'Remove images', args: [{ name: 'image' }] },
  { name: 'pull', description: 'Pull an image', args: [{ name: 'image' }] },
  { name: 'push', description: 'Push an image', args: [{ name: 'image' }] },
  { name: 'logs', description: 'Fetch logs of a container', args: [{ name: 'container' }], flags: [
    { name: 'follow', short: 'f', description: 'Follow log output' },
    { name: 'tail', description: 'Number of lines to show', takesValue: true },
  ]},
  { name: 'compose', description: 'Docker Compose operations', subcommands: [
    { name: 'up', description: 'Create and start containers', flags: [
      { name: 'detach', short: 'd', description: 'Detached mode' },
      { name: 'build', description: 'Build images before starting' },
    ]},
    { name: 'down', description: 'Stop and remove containers', flags: [
      { name: 'volumes', short: 'v', description: 'Remove named volumes' },
    ]},
    { name: 'logs', description: 'View output from containers', flags: [
      { name: 'follow', short: 'f', description: 'Follow log output' },
    ]},
    { name: 'build', description: 'Build services' },
    { name: 'restart', description: 'Restart services' },
  ]},
];

const KUBECTL_SUBCOMMANDS: SubcommandSpec[] = [
  { name: 'get', description: 'Display resources', args: [{ name: 'resource', suggestions: ['pods', 'services', 'deployments', 'nodes', 'configmaps', 'secrets', 'ingress', 'jobs', 'cronjobs'] }, { name: 'name' }], flags: [
    { name: 'namespace', short: 'n', description: 'Namespace scope', takesValue: true },
    { name: 'all-namespaces', short: 'A', description: 'All namespaces' },
    { name: 'output', short: 'o', description: 'Output format', takesValue: true },
    { name: 'watch', short: 'w', description: 'Watch for changes' },
    { name: 'selector', short: 'l', description: 'Selector filter', takesValue: true },
  ]},
  { name: 'describe', description: 'Show details of a resource', args: [{ name: 'resource' }, { name: 'name' }], flags: [
    { name: 'namespace', short: 'n', description: 'Namespace scope', takesValue: true },
  ]},
  { name: 'apply', description: 'Apply configuration', args: [{ name: 'file', template: 'file' }], flags: [
    { name: 'file', short: 'f', description: 'File path', takesValue: true },
    { name: 'namespace', short: 'n', description: 'Namespace scope', takesValue: true },
    { name: 'dry-run', description: 'Dry run mode', takesValue: true },
  ]},
  { name: 'delete', description: 'Delete resources', args: [{ name: 'resource' }, { name: 'name' }], flags: [
    { name: 'namespace', short: 'n', description: 'Namespace scope', takesValue: true },
    { name: 'force', short: 'f', description: 'Immediate shutdown' },
    { name: 'all', description: 'Delete all resources' },
  ]},
  { name: 'logs', description: 'Print pod logs', args: [{ name: 'pod' }], flags: [
    { name: 'namespace', short: 'n', description: 'Namespace scope', takesValue: true },
    { name: 'follow', short: 'f', description: 'Follow log output' },
    { name: 'tail', description: 'Lines from end of logs', takesValue: true },
    { name: 'previous', short: 'p', description: 'Previous terminated container' },
  ]},
  { name: 'exec', description: 'Execute command in container', args: [{ name: 'pod' }], flags: [
    { name: 'namespace', short: 'n', description: 'Namespace scope', takesValue: true },
    { name: 'interactive', short: 'it', description: 'Interactive mode' },
  ]},
  { name: 'port-forward', description: 'Forward ports to pod', args: [{ name: 'pod' }], flags: [
    { name: 'namespace', short: 'n', description: 'Namespace scope', takesValue: true },
  ]},
  { name: 'rollout', description: 'Manage rollout of a resource', subcommands: [
    { name: 'status', description: 'Show rollout status' },
    { name: 'restart', description: 'Restart a resource' },
    { name: 'history', description: 'Show rollout history' },
    { name: 'undo', description: 'Undo rollout' },
    { name: 'pause', description: 'Pause rollout' },
    { name: 'resume', description: 'Resume paused rollout' },
  ]},
  { name: 'top', description: 'Show resource usage', subcommands: [
    { name: 'pods', description: 'Show pod resource usage', flags: [
      { name: 'namespace', short: 'n', description: 'Namespace scope', takesValue: true },
    ]},
    { name: 'nodes', description: 'Show node resource usage' },
  ]},
  { name: 'config', description: 'Modify kubeconfig', subcommands: [
    { name: 'current-context', description: 'Show current context' },
    { name: 'get-contexts', description: 'List contexts' },
    { name: 'use-context', description: 'Switch context', args: [{ name: 'context' }] },
    { name: 'view', description: 'Show merged config' },
  ]},
];

const GH_SUBCOMMANDS: SubcommandSpec[] = [
  { name: 'pr', description: 'Pull request operations', subcommands: [
    { name: 'list', description: 'List PRs', flags: [
      { name: 'state', description: 'Filter by state (open/closed/merged/all)', takesValue: true },
      { name: 'author', description: 'Filter by author', takesValue: true },
      { name: 'limit', description: 'Max results', takesValue: true },
    ]},
    { name: 'create', description: 'Create a PR', flags: [
      { name: 'title', description: 'PR title', takesValue: true },
      { name: 'body', description: 'PR body', takesValue: true },
      { name: 'base', description: 'Base branch', takesValue: true },
      { name: 'head', description: 'Head branch', takesValue: true },
      { name: 'draft', description: 'Mark as draft' },
    ]},
    { name: 'view', description: 'View a PR', args: [{ name: 'number' }] },
    { name: 'checkout', description: 'Checkout PR locally', args: [{ name: 'number' }] },
    { name: 'merge', description: 'Merge a PR', args: [{ name: 'number' }] },
    { name: 'close', description: 'Close a PR', args: [{ name: 'number' }] },
    { name: 'checks', description: 'View CI status', args: [{ name: 'number' }] },
  ]},
  { name: 'issue', description: 'Issue operations', subcommands: [
    { name: 'list', description: 'List issues', flags: [
      { name: 'state', description: 'Filter by state', takesValue: true },
      { name: 'author', description: 'Filter by author', takesValue: true },
      { name: 'assignee', description: 'Filter by assignee', takesValue: true },
    ]},
    { name: 'create', description: 'Create an issue', flags: [
      { name: 'title', description: 'Issue title', takesValue: true },
      { name: 'body', description: 'Issue body', takesValue: true },
    ]},
    { name: 'view', description: 'View an issue', args: [{ name: 'number' }] },
    { name: 'close', description: 'Close an issue', args: [{ name: 'number' }] },
  ]},
  { name: 'repo', description: 'Repository operations', subcommands: [
    { name: 'clone', description: 'Clone a repo', args: [{ name: 'repo' }] },
    { name: 'view', description: 'View a repo' },
    { name: 'create', description: 'Create a new repo', flags: [
      { name: 'public', description: 'Public repository' },
      { name: 'private', description: 'Private repository' },
      { name: 'description', description: 'Repo description', takesValue: true },
    ]},
    { name: 'fork', description: 'Fork a repo' },
    { name: 'delete', description: 'Delete a repo' },
  ]},
  { name: 'auth', description: 'Authentication', subcommands: [
    { name: 'login', description: 'Login with GitHub' },
    { name: 'status', description: 'Check auth status' },
    { name: 'logout', description: 'Logout' },
  ]},
  { name: 'run', description: 'View workflow runs', subcommands: [
    { name: 'list', description: 'List workflow runs' },
    { name: 'view', description: 'View a specific run', args: [{ name: 'id' }] },
    { name: 'watch', description: 'Watch a run' },
  ]},
  { name: 'release', description: 'Release operations', subcommands: [
    { name: 'create', description: 'Create a release', flags: [
      { name: 'title', description: 'Release title', takesValue: true },
      { name: 'notes', description: 'Release notes', takesValue: true },
      { name: 'tag', description: 'Tag name', takesValue: true },
      { name: 'prerelease', description: 'Mark as prerelease' },
      { name: 'draft', description: 'Mark as draft' },
    ]},
    { name: 'list', description: 'List releases' },
    { name: 'download', description: 'Download assets', args: [{ name: 'tag' }] },
    { name: 'delete', description: 'Delete a release', args: [{ name: 'tag' }] },
  ]},
  { name: 'api', description: 'Make API request', args: [{ name: 'endpoint' }], flags: [
    { name: 'method', description: 'HTTP method', takesValue: true },
    { name: 'field', short: 'F', description: 'Add field', takesValue: true, repeatable: true },
  ]},
];

/** Build the command specs map */
export const COMMAND_SPECS: Map<string, CommandSpec> = new Map([
  // Git
  ['git', { name: 'git', description: 'Distributed version control', subcommands: GIT_SUBCOMMANDS }],
  // Package managers
  ['npm', { name: 'npm', description: 'JavaScript package manager', subcommands: NPM_SUBCOMMANDS }],
  ['npx', { name: 'npx', description: 'Run npm packages', args: [{ name: 'package' }] }],
  ['pnpm', { name: 'pnpm', description: 'Fast disk-efficient package manager', subcommands: NPM_SUBCOMMANDS.map(s => ({ ...s })) }],
  ['yarn', { name: 'yarn', description: 'Dependency management tool', subcommands: NPM_SUBCOMMANDS.filter(s => ['install', 'run', 'test', 'build', 'add', 'remove', 'init'].some(n => n === s.name)).map(s => ({ ...s })) }],
  ['bun', { name: 'bun', description: 'Fast JavaScript runtime & package manager', subcommands: BUN_SUBCOMMANDS }],
  // Rust
  ['cargo', { name: 'cargo', description: 'Rust package manager', subcommands: CARGO_SUBCOMMANDS }],
  ['rustc', { name: 'rustc', description: 'Rust compiler', flags: [
    { name: 'edition', description: 'Edition to use', takesValue: true },
    { name: 'verbose', short: 'v', description: 'Verbose output', repeatable: true },
    { name: 'emit', description: 'Types of output to emit', takesValue: true },
  ]}],
  // Docker
  ['docker', { name: 'docker', description: 'Container platform CLI', subcommands: DOCKER_SUBCOMMANDS }],
  // Kubernetes
  ['kubectl', { name: 'kubectl', description: 'Kubernetes control plane', subcommands: KUBECTL_SUBCOMMANDS }],
  // GitHub CLI
  ['gh', { name: 'gh', description: 'GitHub official CLI', subcommands: GH_SUBCOMMANDS }],
  // File ops
  ['ls', { name: 'ls', description: 'List directory contents', flags: [
    { name: 'all', short: 'a', description: 'Show hidden files' },
    { name: 'long', short: 'l', description: 'Long format' },
    { name: 'human-readable', short: 'h', description: 'Human-readable sizes' },
    { name: 'recursive', short: 'R', description: 'Recursive listing' },
    { name: 'reverse', short: 'r', description: 'Reverse order' },
    { name: 'sort', description: 'Sort by field', takesValue: true },
  ], args: [{ name: 'path', template: 'folder' }] }],
  ['cd', { name: 'cd', description: 'Change directory', args: [{ name: 'path', template: 'folder', suggestions: ['~', '..', '../', '-'] }] }],
  ['cat', { name: 'cat', description: 'Concatenate and print files', args: [{ name: 'file', template: 'file' }], flags: [
    { name: 'number', short: 'n', description: 'Number all output lines' },
    { name: 'show-nonprinting', short: 'A', description: 'Show non-printing chars' },
  ]}],
  ['grep', { name: 'grep', description: 'Search patterns in files', args: [{ name: 'pattern' }, { name: 'path', template: 'file' }], flags: [
    { name: 'ignore-case', short: 'i', description: 'Case insensitive' },
    { name: 'recursive', short: 'r', description: 'Recursive search' },
    { name: 'line-number', short: 'n', description: 'Show line numbers' },
    { name: 'count', short: 'c', description: 'Count matches only' },
    { name: 'files-with-matches', short: 'l', description: 'Files with matches' },
    { name: 'context', short: 'C', description: 'Context lines', takesValue: true },
    { name: 'extended-regexp', short: 'E', description: 'Extended regex' },
  ]}],
  ['find', { name: 'find', description: 'Search for files', args: [{ name: 'path', template: 'folder', suggestions: ['.'] }], flags: [
    { name: 'name', description: 'Pattern for filename', takesValue: true },
    { name: 'type', description: 'File type (f/d/l)', takesValue: true },
    { name: 'max-depth', description: 'Max depth', takesValue: true },
  ]}],
  ['mkdir', { name: 'mkdir', description: 'Create directories', args: [{ name: 'path' }], flags: [
    { name: 'parents', short: 'p', description: 'Create parent dirs as needed' },
    { name: 'verbose', short: 'v', description: 'Print created directories' },
  ]}],
  ['rm', { name: 'rm', description: 'Remove files/directories', args: [{ name: 'path', template: 'file' }], flags: [
    { name: 'recursive', short: 'r', description: 'Recursive removal' },
    { name: 'force', short: 'f', description: 'Force without prompt' },
    { name: 'dir', description: 'Remove empty directories' },
  ]}],
  ['cp', { name: 'cp', description: 'Copy files/directories', args: [{ name: 'source', template: 'file' }, { name: 'dest' }], flags: [
    { name: 'recursive', short: 'r', description: 'Recursive copy' },
    { name: 'force', short: 'f', description: 'Force overwrite' },
    { name: 'interactive', short: 'i', description: 'Prompt before overwrite' },
  ]}],
  ['mv', { name: 'mv', description: 'Move/rename files', args: [{ name: 'source', template: 'file' }, { name: 'dest' }], flags: [
    { name: 'force', short: 'f', description: 'Force overwrite' },
    { name: 'interactive', short: 'i', description: 'Prompt before overwrite' },
  ]}],
  ['touch', { name: 'touch', description: 'Create empty file / update timestamps', args: [{ name: 'file' }] }],
  ['chmod', { name: 'chmod', description: 'Change permissions', args: [{ name: 'mode' }, { name: 'path', template: 'file' }] }],
  ['chown', { name: 'chown', description: 'Change owner', args: [{ name: 'owner' }, { name: 'path', template: 'file' }] }],
  ['echo', { name: 'echo', description: 'Print text', args: [{ name: 'text' }], flags: [
    { name: 'no-newline', short: 'n', description: 'No trailing newline' },
    { name: 'escape', short: 'e', description: 'Interpret escapes' },
  ]}],
  ['wget', { name: 'wget', description: 'Download files from web', args: [{ name: 'url' }], flags: [
    { name: 'output-document', short: 'O', description: 'Output file', takesValue: true },
    { name: 'continue', short: 'c', description: 'Resume download' },
  ]}],
  ['curl', { name: 'curl', description: 'Transfer data from URL', args: [{ name: 'url' }], flags: [
    { name: 'request', short: 'X', description: 'HTTP method', takesValue: true },
    { name: 'header', short: 'H', description: 'Custom header', takesValue: true, repeatable: true },
    { name: 'data', short: 'd', description: 'POST data', takesValue: true },
    { name: 'output', short: 'o', description: 'Output file', takesValue: true },
    { name: 'silent', short: 's', description: 'Silent mode' },
    { name: 'location', short: 'L', description: 'Follow redirects' },
    { name: 'include', short: 'i', description: 'Include headers in output' },
  ]}],
  ['ssh', { name: 'ssh', description: 'Remote shell connection', args: [{ name: 'host' }], flags: [
    { name: 'port', short: 'p', description: 'Port number', takesValue: true },
    { name: 'identity-file', short: 'i', description: 'Identity file', takesValue: true },
  ]}],
  ['scp', { name: 'scp', description: 'Secure copy over SSH', args: [{ name: 'source' }, { name: 'dest' }], flags: [
    { name: 'port', short: 'p', description: 'Port number', takesValue: true },
    { name: 'recursive', short: 'r', description: 'Recursive copy' },
  ]}],
  ['tar', { name: 'tar', description: 'Archive utility', flags: [
    { name: 'create', short: 'c', description: 'Create archive' },
    { name: 'extract', short: 'x', description: 'Extract archive' },
    { name: 'list', short: 't', description: 'List archive contents' },
    { name: 'verbose', short: 'v', description: 'Verbose output' },
    { name: 'file', short: 'f', description: 'Archive file', takesValue: true },
  ]}],
  ['zip', { name: 'zip', description: 'Compress to zip', args: [{ name: 'archive' }, { name: 'files', template: 'file' }], flags: [
    { name: 'recursive', short: 'r', description: 'Recurse directories' },
    { name: 'quiet', short: 'q', description: 'Quiet mode' },
  ]}],
  ['unzip', { name: 'unzip', description: 'Extract zip archive', args: [{ name: 'archive' }] }],
  ['ps', { name: 'ps', description: 'Process status', flags: [
    { name: 'aux', description: 'BSD-style full listing' },
    { name: 'ef', description: 'Full-format listing' },
  ]}],
  ['kill', { name: 'kill', description: 'Send signal to process', args: [{ name: 'pid' }], flags: [
    { name: 'signal', short: 's', description: 'Signal name/number', takesValue: true },
    { name: 'list', short: 'l', description: 'List signals' },
  ]}],
  ['top', { name: 'top', description: 'Process viewer', flags: [
    { name: 'batch-mode', short: 'b', description: 'Batch mode' },
    { name: 'iterations', short: 'n', description: 'Iterations', takesValue: true },
  ]}],
  ['htop', { name: 'htop', description: 'Interactive process viewer' }],
  ['env', { name: 'env', description: 'Environment variables', flags: [
    { name: 'ignore-environment', short: 'i', description: 'Start with empty environment' },
  ]}],
  ['which', { name: 'which', description: 'Locate a command', args: [{ name: 'command' }] }],
  ['where', { name: 'where', description: 'Locate executable (Windows)', args: [{ name: 'command' }] }],
  ['python', { name: 'python', description: 'Python interpreter', args: [{ name: 'script', template: 'file' }], flags: [
    { name: 'version', description: 'Show version' },
    { name: 'module', short: 'm', description: 'Run module', takesValue: true },
  ]}],
  ['python3', { name: 'python3', description: 'Python 3 interpreter', args: [{ name: 'script', template: 'file' }] }],
  ['node', { name: 'node', description: 'Node.js runtime', args: [{ name: 'script', template: 'file' }] }],
  ['deno', { name: 'deno', description: 'Secure TypeScript runtime', args: [{ name: 'script', template: 'file' }], flags: [
    { name: 'allow-net', description: 'Allow network access' },
    { name: 'allow-read', description: 'Allow file system read' },
    { name: 'allow-write', description: 'Allow file system write' },
    { name: 'allow-env', description: 'Allow env access' },
    { name: 'watch', short: 'w', description: 'Watch mode' },
  ]}],
  ['go', { name: 'go', description: 'Go toolchain', subcommands: [
    { name: 'build', description: 'Compile packages' },
    { name: 'run', description: 'Compile and run program', args: [{ name: 'package' }] },
    { name: 'test', description: 'Test packages' },
    { name: 'mod', description: 'Module maintenance', subcommands: [
      { name: 'tidy', description: 'Add missing modules' },
      { name: 'download', description: 'Download modules' },
      { name: 'verify', description: 'Verify dependencies' },
    ]},
    { name: 'vet', description: 'Report suspicious constructs' },
    { name: 'fmt', description: 'Format packages' },
    { name: 'install', description: 'Compile and install packages' },
    { name: 'get', description: 'Add dependencies' },
    { name: 'generate', description: 'Generate source code' },
  ]}],
  ['make', { name: 'make', description: 'Build automation', args: [{ name: 'target' }], flags: [
    { name: 'directory', short: 'C', description: 'Change directory', takesValue: true },
    { name: 'jobs', short: 'j', description: 'Parallel jobs', takesValue: true },
  ]}],
  ['cmake', { name: 'cmake', description: 'Build system generator', flags: [
    { name: 'build', short: 'B', description: 'Build directory', takesValue: true },
    { name: 'generator', short: 'G', description: 'Generator', takesValue: true },
  ]}],
  ['sed', { name: 'sed', description: 'Stream editor', args: [{ name: 'expression' }, { name: 'file', template: 'file' }], flags: [
    { name: 'in-place', short: 'i', description: 'Edit files in place' },
  ]}],
  ['awk', { name: 'awk', description: 'Text processing language', args: [{ name: 'program' }, { name: 'file', template: 'file' }] }],
  ['sort', { name: 'sort', description: 'Sort lines', flags: [
    { name: 'reverse', short: 'r', description: 'Reverse sort' },
    { name: 'numeric', short: 'n', description: 'Numeric sort' },
    { name: 'unique', short: 'u', description: 'Unique lines' },
    { name: 'field-separator', short: 't', description: 'Field separator', takesValue: true },
  ]}],
  ['wc', { name: 'wc', description: 'Word/line/byte count', flags: [
    { name: 'lines', short: 'l', description: 'Line count' },
    { name: 'words', short: 'w', description: 'Word count' },
    { name: 'bytes', short: 'c', description: 'Byte count' },
    { name: 'chars', short: 'm', description: 'Char count' },
  ]}],
  ['head', { name: 'head', description: 'First lines of file', args: [{ name: 'file', template: 'file' }], flags: [
    { name: 'lines', short: 'n', description: 'Number of lines', takesValue: true },
  ]}],
  ['tail', { name: 'tail', description: 'Last lines of file', args: [{ name: 'file', template: 'file' }], flags: [
    { name: 'lines', short: 'n', description: 'Number of lines', takesValue: true },
    { name: 'follow', short: 'f', description: 'Append as file grows' },
  ]}],
  ['less', { name: 'less', description: 'Pager for viewing files', args: [{ name: 'file', template: 'file' }] }],
  ['more', { name: 'more', description: 'Simple pager', args: [{ name: 'file', template: 'file' }] }],
  ['df', { name: 'df', description: 'Disk free space', flags: [
    { name: 'human-readable', short: 'h', description: 'Human-readable sizes' },
  ]}],
  ['du', { name: 'du', description: 'Disk usage', args: [{ name: 'path', template: 'folder' }], flags: [
    { name: 'human-readable', short: 'h', description: 'Human-readable sizes' },
    { name: 'max-depth', description: 'Max depth', takesValue: true },
    { name: 'summarize', short: 's', description: 'Total only' },
  ]}],
  ['history', { name: 'history', description: 'Command history', flags: [
    { name: 'clear', short: 'c', description: 'Clear history' },
  ]}],
  ['clear', { name: 'clear', description: 'Clear terminal screen' }],
  ['exit', { name: 'exit', description: 'Exit shell' }],
  ['sudo', { name: 'sudo', description: 'Execute as root', args: [{ name: 'command' }], flags: [
    { name: 'user', short: 'u', description: 'Run as user', takesValue: true },
  ]}],
]);
