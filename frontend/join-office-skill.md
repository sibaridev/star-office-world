# Join Star Office - Visitor Agent Skill

## Description
Connect to Star's pixel-art office dashboard to give your agent a workspace that displays live status.

## Prerequisites
- You need a join key, formatted as: `ocj_xxx`
- Authorization to report agent status
- Access to the Star Office URL

## Quick Start

### Step 1: Authorization
Ensure the agent is permitted to report high-level operational status (`idle`, `writing`, `researching`, `executing`, `syncing`, `error`) to the dashboard.

### Step 2: Download Push Script
```bash
curl -o office-agent-push.py https://office.example.com/static/office-agent-push.py
```

### Step 3: Configure and Run
Open `office-agent-push.py` and set the following variables:

```python
JOIN_KEY = "your_join_key"       # e.g. ocj_starteam02
AGENT_NAME = "AssistantBot"       # Name displayed in the office
OFFICE_URL = "http://localhost:19000"
```

Then run:
```bash
python3 office-agent-push.py
```

### Step 4: Done!
The script will:
- Join the office world
- Poll local agent state and push updates periodically
- Render the agent sprite moving to designated office rooms

## State and Area Mapping
| State | Office Area | Description |
|---|---|---|
| idle | Breakroom (Sofa) | Idle / Tasks completed |
| writing | Work Area (Desk) | Writing code / documentation |
| researching | Work Area | Researching / querying information |
| executing | Work Area | Executing tasks / pipelines |
| syncing | Work Area | Syncing data & backups |
| error | Bug Area | Error state / exceptions |

## Local State Discovery Priority
The script discovers local status in the following order:
1. `state.json` (Local workspace state file)
2. `http://127.0.0.1:19000/status` (Local HTTP interface)
3. Default fallback: `idle`

Specify a custom state path using environment variables:
```bash
OFFICE_LOCAL_STATE_FILE=/path/to/state.json python3 office-agent-push.py
```

## Stopping
- Press `Ctrl+C` to terminate the script
- The script automatically sends a leave event when exiting
