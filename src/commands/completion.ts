/**
 * ABOUTME: Shell completion command for ralph-tui CLI.
 * Generates shell-specific completion scripts for bash, zsh, and fish.
 */

export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/**
 * Print completion help information.
 */
export function printCompletionHelp(): void {
  console.log(`
Generate shell completion scripts

Usage: ralph-tui completion <shell>

Options:
  <shell>   Shell type: bash, zsh, or fish

Examples:
  ralph-tui completion bash    # Generate bash completion
  ralph-tui completion zsh     # Generate zsh completion
  ralph-tui completion fish    # Generate fish completion

Installation:
  Bash:
    ralph-tui completion bash > ~/.local/share/bash-completion/completions/ralph-tui
    or
    ralph-tui completion bash | sudo tee /usr/share/bash-completion/completions/ralph-tui

  Zsh:
    ralph-tui completion zsh > ~/.zfunc/_ralph-tui
    Add to ~/.zshrc: fpath=(~/.zfunc $fpath); autoload -U compinit && compinit

  Fish:
    ralph-tui completion fish > ~/.config/fish/completions/ralph-tui.fish
`);
}

/**
 * Generate bash completion script.
 */
function generateBashCompletion(): string {
  return `# ralph-tui bash completion
_ralph_tui_completion() {
    local cur prev words cword
    _init_completion || return

    # Main commands
    local commands="run resume status config setup logs template create-prd convert docs doctor info skills listen remote plugins"

    case $prev in
        run)
            COMPREPLY=($(compgen -W "--epic --prd --force --no-setup --agent --tracker --yolo --max-iterations --headless --resume -h --help" -- "$cur"))
            ;;
        resume)
            COMPREPLY=($(compgen -W "--force -h --help" -- "$cur"))
            ;;
        status)
            COMPREPLY=($(compgen -W "--json -h --help" -- "$cur"))
            ;;
        config)
            COMPREPLY=($(compgen -W "show set get --toml --sources -h --help" -- "$cur"))
            ;;
        setup)
            COMPREPLY=($(compgen -W "--skip-agent --skip-tracker -h --help" -- "$cur"))
            ;;
        logs)
            COMPREPLY=($(compgen -W "--iteration --task --list --clean --keep --verbose -h --help" -- "$cur"))
            ;;
        template)
            COMPREPLY=($(compgen -W "show create install -h --help" -- "$cur"))
            ;;
        create-prd)
            COMPREPLY=($(compgen -W "--agent --output --skip -h --help" -- "$cur"))
            ;;
        convert)
            COMPREPLY=($(compgen -W "--to --input --output --branch -h --help" -- "$cur"))
            ;;
        docs)
            COMPREPLY=($(compgen -W "--section --open -h --help" -- "$cur"))
            ;;
        skills)
            COMPREPLY=($(compgen -W "list install --agent --local --global -h --help" -- "$cur"))
            ;;
        listen)
            COMPREPLY=($(compgen -W "--host --port --daemon --rotate-token -h --help" -- "$cur"))
            ;;
        remote)
            COMPREPLY=($(compgen -W "add list remove test push -h --help" -- "$cur"))
            ;;
        plugins)
            COMPREPLY=($(compgen -W "list agents trackers -h --help" -- "$cur"))
            ;;
        *)
            if [[ $cword -eq 1 ]]; then
                COMPREPLY=($(compgen -W "$commands" -- "$cur"))
            fi
            ;;
    esac
}

complete -F _ralph_tui_completion ralph-tui
`;
}

/**
 * Generate zsh completion script.
 */
function generateZshCompletion(): string {
  return `#compdef ralph-tui

_ralph_tui() {
    local -a commands
    commands=(
        'run:Run Ralph with tasks'
        'resume:Resume a paused session'
        'status:Show Ralph status'
        'config:Manage configuration'
        'setup:Initial setup wizard'
        'logs:View iteration logs'
        'template:Manage prompt templates'
        'create-prd:Create a PRD with AI'
        'convert:Convert PRD formats'
        'docs:Open documentation'
        'doctor:Run diagnostics'
        'info:System information'
        'skills:Manage skills'
        'listen:Start remote listener'
        'remote:Manage remote connections'
        'plugins:List plugins'
    )

    if (( CURRENT == 2 )); then
        _describe 'command' commands
        return
    fi

    local -a args
    case $words[2] in
        run)
            args=(
                '--epic[Epic ID to run]:epic_id'
                '--prd[PRD file path]:file:_files'
                '--force[Force start fresh session]'
                '--no-setup[Skip setup wizard]'
                '--agent[Agent plugin]:agent:(claude opencode gemini codex kiro iflow)'
                '--tracker[Tracker plugin]:tracker:(beads json beads-bv beads-rust)'
                '--yolo[Enable YOLO mode]'
                '--max-iterations[Max iterations]:number'
                '--headless[Run in headless mode]'
                '--resume[Auto-resume last session]'
                {-h,--help}'[Show help]'
            )
            ;;
        resume)
            args=(
                '--force[Force resume]'
                {-h,--help}'[Show help]'
            )
            ;;
        status)
            args=(
                '--json[Output as JSON]'
                {-h,--help}'[Show help]'
            )
            ;;
        config)
            args=(
                'show[Show current config]'
                'set:Set config value]'
                'get[Get config value]'
                '--toml[Show raw TOML]'
                '--sources[Show config file locations]'
                {-h,--help}'[Show help]'
            )
            ;;
        logs)
            args=(
                '--iteration[Show specific iteration]:number'
                '--task[Show logs for task]:task_id'
                '--list[List all iterations]'
                '--clean[Clean old logs]'
                '--keep[Keep N logs]:number'
                '--verbose[Show full output]'
                {-h,--help}'[Show help]'
            )
            ;;
        template)
            args=(
                'show[Show template source]'
                'create[Create new template]'
                'install[Install templates]'
                {-h,--help}'[Show help]'
            )
            ;;
        create-prd)
            args=(
                '--agent[Agent to use]:agent:(claude opencode gemini codex kiro iflow)'
                '--output[Output file]:file:_files'
                '--skip[Skip confirmation]'
                {-h,--help}'[Show help]'
            )
            ;;
        convert)
            args=(
                '--to[Target format]:format:(json beads)'
                '--input[Input file]:file:_files'
                '--output[Output file]:file:_files'
                '--branch[Create branch]'
                {-h,--help}'[Show help]'
            )
            ;;
        docs)
            args=(
                '--section[Documentation section]:section:(quickstart cli plugins templates contributing)'
                '--open[Open in browser]'
                {-h,--help}'[Show help]'
            )
            ;;
        skills)
            args=(
                'list[List bundled skills]'
                'install[Install skills]'
                '--agent[Target agent]:agent:(claude opencode gemini codex kiro iflow)'
                '--local[Install locally]'
                '--global[Install globally]'
                {-h,--help}'[Show help]'
            )
            ;;
        listen)
            args=(
                '--host[Bind host]:host'
                '--port[Bind port]:port'
                '--daemon[Run as daemon]'
                '--rotate-token[Rotate server token]'
                {-h,--help}'[Show help]'
            )
            ;;
        remote)
            args=(
                'add:Add remote connection]'
                'list[List remotes]'
                'remove[Remove remote]'
                'test[Test connection]'
                'push[Push config to remote]'
                {-h,--help}'[Show help]'
            )
            ;;
        plugins)
            args=(
                'list[List all plugins]'
                'agents[List agent plugins]'
                'trackers[List tracker plugins]'
                {-h,--help}'[Show help]'
            )
            ;;
    esac

    _describe 'options' args
}

_ralph_tui "$@"
`;
}

/**
 * Generate fish completion script.
 */
function generateFishCompletion(): string {
  return `# ralph-tui fish completion

complete -c ralph-tui -f

# Main commands
complete -c ralph-tui -n __fish_use_subcommand -a run -d 'Run Ralph with tasks'
complete -c ralph-tui -n __fish_use_subcommand -a resume -d 'Resume a paused session'
complete -c ralph-tui -n __fish_use_subcommand -a status -d 'Show Ralph status'
complete -c ralph-tui -n __fish_use_subcommand -a config -d 'Manage configuration'
complete -c ralph-tui -n __fish_use_subcommand -a setup -d 'Initial setup wizard'
complete -c ralph-tui -n __fish_use_subcommand -a logs -d 'View iteration logs'
complete -c ralph-tui -n __fish_use_subcommand -a template -d 'Manage prompt templates'
complete -c ralph-tui -n __fish_use_subcommand -a create-prd -d 'Create a PRD with AI'
complete -c ralph-tui -n __fish_use_subcommand -a convert -d 'Convert PRD formats'
complete -c ralph-tui -n __fish_use_subcommand -a docs -d 'Open documentation'
complete -c ralph-tui -n __fish_use_subcommand -a doctor -d 'Run diagnostics'
complete -c ralph-tui -n __fish_use_subcommand -a info -d 'System information'
complete -c ralph-tui -n __fish_use_subcommand -a skills -d 'Manage skills'
complete -c ralph-tui -n __fish_use_subcommand -a listen -d 'Start remote listener'
complete -c ralph-tui -n __fish_use_subcommand -a remote -d 'Manage remote connections'
complete -c ralph-tui -n __fish_use_subcommand -a plugins -d 'List plugins'

# Run command options
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l epic -d 'Epic ID to run'
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l prd -d 'PRD file path' -r
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l force -d 'Force start fresh session'
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l no-setup -d 'Skip setup wizard'
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l agent -d 'Agent plugin' -xa 'claude opencode gemini codex kiro iflow'
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l tracker -d 'Tracker plugin' -xa 'beads json beads-bv beads-rust'
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l yolo -d 'Enable YOLO mode'
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l max-iterations -d 'Max iterations'
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l headless -d 'Run in headless mode'
complete -c ralph-tui -n '__fish_seen_subcommand_from run run' -l resume -d 'Auto-resume last session'

# Resume command options
complete -c ralph-tui -n '__fish_seen_subcommand_from resume' -l force -d 'Force resume'

# Status command options
complete -c ralph-tui -n '__fish_seen_subcommand_from status' -l json -d 'Output as JSON'

# Config command options
complete -c ralph-tui -n '__fish_seen_subcommand_from config' -a 'show set get'
complete -c ralph-tui -n '__fish_seen_subcommand_from config' -l toml -d 'Show raw TOML'
complete -c ralph-tui -n '__fish_seen_subcommand_from config' -l sources -d 'Show config file locations'

# Logs command options
complete -c ralph-tui -n '__fish_seen_subcommand_from logs' -l iteration -d 'Show specific iteration'
complete -c ralph-tui -n '__fish_seen_subcommand_from logs' -l task -d 'Show logs for task'
complete -c ralph-tui -n '__fish_seen_subcommand_from logs' -l list -d 'List all iterations'
complete -c ralph-tui -n '__fish_seen_subcommand_from logs' -l clean -d 'Clean old logs'
complete -c ralph-tui -n '__fish_seen_subcommand_from logs' -l keep -d 'Keep N logs'
complete -c ralph-tui -n '__fish_seen_subcommand_from logs' -l verbose -d 'Show full output'

# Template command options
complete -c ralph-tui -n '__fish_seen_subcommand_from template' -a 'show create install'

# Create-prd command options
complete -c ralph-tui -n '__fish_seen_subcommand_from create-prd' -l agent -d 'Agent to use' -xa 'claude opencode gemini codex kiro iflow'
complete -c ralph-tui -n '__fish_seen_subcommand_from create-prd' -l output -d 'Output file' -r
complete -c ralph-tui -n '__fish_seen_subcommand_from create-prd' -l skip -d 'Skip confirmation'

# Convert command options
complete -c ralph-tui -n '__fish_seen_subcommand_from convert' -l to -d 'Target format' -xa 'json beads'
complete -c ralph-tui -n '__fish_seen_subcommand_from convert' -l input -d 'Input file' -r
complete -c ralph-tui -n '__fish_seen_subcommand_from convert' -l output -d 'Output file' -r
complete -c ralph-tui -n '__fish_seen_subcommand_from convert' -l branch -d 'Create branch'

# Docs command options
complete -c ralph-tui -n '__fish_seen_subcommand_from docs' -l section -d 'Documentation section' -xa 'quickstart cli plugins templates contributing'
complete -c ralph-tui -n '__fish_seen_subcommand_from docs' -l open -d 'Open in browser'

# Skills command options
complete -c ralph-tui -n '__fish_seen_subcommand_from skills' -a 'list install'
complete -c ralph-tui -n '__fish_seen_subcommand_from skills' -l agent -d 'Target agent' -xa 'claude opencode gemini codex kiro iflow'
complete -c ralph-tui -n '__fish_seen_subcommand_from skills' -l local -d 'Install locally'
complete -c ralph-tui -n '__fish_seen_subcommand_from skills' -l global -d 'Install globally'

# Listen command options
complete -c ralph-tui -n '__fish_seen_subcommand_from listen' -l host -d 'Bind host'
complete -c ralph-tui -n '__fish_seen_subcommand_from listen' -l port -d 'Bind port'
complete -c ralph-tui -n '__fish_seen_subcommand_from listen' -l daemon -d 'Run as daemon'
complete -c ralph-tui -n '__fish_seen_subcommand_from listen' -l rotate-token -d 'Rotate server token'

# Remote command options
complete -c ralph-tui -n '__fish_seen_subcommand_from remote' -a 'add list remove test push'

# Plugins command options
complete -c ralph-tui -n '__fish_seen_subcommand_from plugins' -a 'list agents trackers'

# Help options
complete -c ralph-tui -l h -d 'Show help'
complete -c ralph-tui -l help -d 'Show help'
`;
}

/**
 * Get completion script for the specified shell.
 */
export function getCompletionScript(shell: CompletionShell): string {
  switch (shell) {
    case 'bash':
      return generateBashCompletion();
    case 'zsh':
      return generateZshCompletion();
    case 'fish':
      return generateFishCompletion();
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

/**
 * Execute completion command.
 */
export async function executeCompletionCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    printCompletionHelp();
    return;
  }

  const shell = args[0] as CompletionShell;

  if (!COMPLETION_SHELLS.includes(shell)) {
    console.error(`Error: Unsupported shell '${shell}'`);
    console.error(`Supported shells: ${COMPLETION_SHELLS.join(', ')}`);
    process.exit(1);
  }

  const script = getCompletionScript(shell);
  console.log(script);
}