"""Outstanding obligations and retrospective counts."""
from collections import defaultdict
from . import ledger


CLOSED = {"obligation_discharged", "obligation_waived"}


def obligation_state(entries, project, ticket):
    state = {}
    for entry in entries:
        if entry.get("project") != project or entry.get("ticket") != ticket:
            continue
        key = (entry.get("gate"), entry.get("obligation"))
        event = entry.get("event")
        if event == "obligation_opened" and key not in state:
            state[key] = {"state": "open", "text": entry.get("text", "")}
        elif event in CLOSED:
            state[key] = {"state": "closed", "text": state.get(key, {}).get("text", "")}
    return state


def summarize(project, ticket, entries=None):
    entries = ledger.read() if entries is None else entries
    state = obligation_state(entries, project, ticket)
    grouped = defaultdict(list)
    for (gate, obligation), value in state.items():
        if value["state"] == "open":
            grouped[gate].append({"id": obligation, "text": value["text"]})
    relevant = [e for e in entries if e.get("project") == project and e.get("ticket") == ticket]
    return {"project": project, "ticket": ticket, "outstanding": dict(grouped), "gates_crossed": sum(e.get("event") == "gate_crossed" for e in relevant), "checks_failed": sum(e.get("event") == "check_failed" for e in relevant)}


def report(since, until=None, project=None, entries=None):
    entries = ledger.read() if entries is None else entries
    selected = [e for e in entries if str(e.get("ts", ""))[:10] >= since and (until is None or str(e.get("ts", ""))[:10] <= until) and (project is None or e.get("project") == project)]
    gates = defaultdict(lambda: {"crossings": 0, "obligations_opened": 0, "discharged": 0, "waived": 0, "still_open": 0, "discharge_rate": 0.0, "waiver_reasons": {}})
    failed = defaultdict(int)
    state = {}
    for entry in selected:
        event = entry.get("event")
        gate = entry.get("gate")
        if event == "check_failed":
            failed[entry.get("check", "unknown")] += 1
        if not gate:
            continue
        group = gates[gate]
        if event == "gate_crossed":
            group["crossings"] += 1
        elif event == "obligation_opened":
            group["obligations_opened"] += 1
            state[(entry.get("project"), entry.get("ticket"), gate, entry.get("obligation"))] = True
        elif event == "obligation_discharged":
            group["discharged"] += 1
            state[(entry.get("project"), entry.get("ticket"), gate, entry.get("obligation"))] = False
        elif event == "obligation_waived":
            group["waived"] += 1
            state[(entry.get("project"), entry.get("ticket"), gate, entry.get("obligation"))] = False
            group["waiver_reasons"].setdefault(entry.get("obligation", ""), []).append(entry.get("reason", ""))
    for key, opened in state.items():
        if opened:
            gates[key[2]]["still_open"] += 1
    for group in gates.values():
        if group["obligations_opened"]:
            group["discharge_rate"] = group["discharged"] / group["obligations_opened"]
    return {"since": since, "until": until, "project": project, "gates": dict(gates), "failed_checks": dict(failed)}
