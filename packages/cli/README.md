# @mushi-mushi/cli

CLI tool for Mushi Mushi project management and report triage.

## Install

```bash
npm install -g @mushi-mushi/cli
```

## Usage

```bash
mushi login              # Authenticate with your API key
mushi status             # Project overview
mushi reports list       # List recent reports
mushi reports show <id>  # View report details
mushi reports triage <id> --priority high --assign @dev
mushi deploy check       # Check edge function health
mushi test               # Submit a test report to verify pipeline
```

## License

MIT
