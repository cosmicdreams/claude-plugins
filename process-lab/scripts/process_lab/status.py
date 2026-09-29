"""Outstanding obligations and retrospective counts."""
from collections import defaultdict
from . import ledger

CLOSED = {"obligation_discharged", "obligation_waived"}
CROSSINGS = {"gate_crossed", "gate_declared"}


def obligation_state(entries, project, ticket):
    state = {}
    for entry in entries:
        if entry.get("project") != project or entry.get("ticket") != ticket:
            continue
        event = entry.get("event")
        gate = entry.get("gate")
        key = (gate, entry.get("obligation"))
        if event == "gate_reopened":
            for old_key, value in list(state.items()):
                if old_key[0] == gate and value["state"] == "closed":
                    state[old_key] = {**value, "state": "open", "opened_at": entry.get("ts")}
        elif event == "obligation_opened" and key not in state:
            state[key] = {"state": "open", "text": entry.get("text", ""), "opened_at": entry.get("ts")}
        elif event in CLOSED and key in state:
            state[key] = {**state[key], "state": "closed"}
    return state


def summarize(project, ticket, entries=None):
    entries = ledger.read() if entries is None else entries
    state = obligation_state(entries, project, ticket)
    grouped = defaultdict(list)
    for (gate, obligation), value in state.items():
        if value["state"] == "open":
            grouped[gate].append({"id": obligation, "text": value["text"], "opened_at": value.get("opened_at")})
    relevant = [e for e in entries if e.get("project") == project and e.get("ticket") == ticket]
    failures = [dict(ts=e.get("ts"), check=e.get("check"), detail=e.get("detail")) for e in relevant if e.get("event") == "check_failed"]
    return {"project": project, "ticket": ticket, "outstanding": dict(grouped), "gates_crossed": sum(e.get("event") in CROSSINGS for e in relevant), "checks_failed": len(failures), "failed_checks": failures[-10:]}


def report(since, until=None, project=None, entries=None):
    entries = ledger.read() if entries is None else entries
    scoped = [e for e in entries if project is None or e.get("project") == project]
    before = [e for e in scoped if str(e.get("ts", ""))[:10] < since]
    window = [e for e in scoped if str(e.get("ts", ""))[:10] >= since and (until is None or str(e.get("ts", ""))[:10] <= until)]
    groups = defaultdict(lambda: {"crossings": 0, "open_at_start": 0, "opened": 0, "discharged": 0, "waived": 0, "reopened": 0, "open_at_end": 0, "discharge_rate": 0.0, "waiver_reasons": {}})
    failures = defaultdict(int)
    def states(items):
        tickets = {(e.get("project"), e.get("ticket")) for e in items}
        return {(project_key, ticket, gate, obligation): value for project_key, ticket in tickets for (gate, obligation), value in obligation_state(items, project_key, ticket).items()}
    start = states(before)
    end = states(before + window)
    for key, value in start.items():
        if value["state"] == "open":
            groups[key[2]]["open_at_start"] += 1
    live = {key: dict(value) for key, value in start.items()}
    for entry in window:
        event, gate = entry.get("event"), entry.get("gate")
        if event == "check_failed":
            failures[entry.get("check", "unknown")] += 1
        if not gate:
            continue
        group = groups[gate]
        if event in CROSSINGS:
            group["crossings"] += 1
        elif event == "obligation_opened":
            key = (entry.get("project"), entry.get("ticket"), gate, entry.get("obligation"))
            if key not in live:
                group["opened"] += 1
                live[key] = {"state": "open"}
        elif event == "obligation_discharged":
            group["discharged"] += 1
            live[(entry.get("project"), entry.get("ticket"), gate, entry.get("obligation"))] = {"state": "closed"}
        elif event == "obligation_waived":
            group["waived"] += 1
            live[(entry.get("project"), entry.get("ticket"), gate, entry.get("obligation"))] = {"state": "closed"}
            group["waiver_reasons"].setdefault(entry.get("obligation", ""), []).append(entry.get("reason", ""))
        elif event == "gate_reopened":
            group["reopened"] += 1
            for key, value in live.items():
                if key[0] == entry.get("project") and key[1] == entry.get("ticket") and key[2] == gate and value["state"] == "closed":
                    group["opened"] += 1
                    value["state"] = "open"
    for key, value in end.items():
        if value["state"] == "open":
            groups[key[2]]["open_at_end"] += 1
    for group in groups.values():
        denominator = group["open_at_start"] + group["opened"]
        group["discharge_rate"] = min(1.0, group["discharged"] / denominator) if denominator else 0.0
        group["obligations_opened"] = group["opened"]
        group["still_open"] = group["open_at_end"]
    return {"since": since, "until": until, "project": project, "gates": dict(groups), "failed_checks": dict(failures)}
