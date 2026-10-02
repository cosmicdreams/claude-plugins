#!/usr/bin/env python3
"""Assemble source measurements for verification without workflow orchestration."""
from __future__ import annotations

import json
from pathlib import Path

from figma_build import components, spec_file_for


def build_measurements(project: Path) -> dict:
    project = Path(project)
    folder = project / "capture/measurements"
    result = {}
    for component in components(project):
        path = spec_file_for(folder, component)
        if path is None:
            continue
        spec = json.loads(path.read_text())
        source = (spec.get("source") or {}).get("sourceRef")
        if source and component.get("sourceRef") and source != component["sourceRef"]:
            continue
        measurement = (spec.get("measurements") or {}).get("desktop:default")
        if measurement and not measurement.get("error") and measurement.get("nodes"):
            result[component["id"]] = measurement
    return result
