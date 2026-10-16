from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError
from test_network import OSM, WAYS, traffic_config

from tbgis.config import BakeConfig
from tbgis.network import NetworkConfig, Shape, bake_network, curve_piece, fit_endpoint_profile
from tbgis.stretch import F64, RealPath


def land(sc: BakeConfig, rp: RealPath) -> tuple[F64, F64, None]:
    s = np.linspace(0, float(rp.cum[-1]), 50)
    return s, np.full_like(s, 20 if sc.id.endswith("-a") else 10), None


def fitted_config(leave: float = 80, join: float = 120) -> NetworkConfig:
    data = traffic_config().model_dump(exclude_none=True)
    data["branches"][0]["leave"]["accessProfileFitM"] = leave
    data["branches"][0]["join"]["accessProfileFitM"] = join
    return NetworkConfig.model_validate(data)


def test_authored_branch_fit_removes_endpoint_lips_without_reshaping_the_shared_junction() -> None:
    original = bake_network(traffic_config(), OSM, WAYS, land, "2026-10-02")
    cfg = fitted_config()
    fitted = bake_network(cfg, OSM, WAYS, land, "2026-10-02")
    old = {r["id"]: r for r in original.roads}
    new = {r["id"]: r for r in fitted.roads}
    branch = cfg.branches[0]
    source = new[branch.id]
    data = source["samples"]["data"]
    station = np.linspace(0, source["lengthM"], len(data["y"]))
    assert branch.leave.accessProfileFitM is not None and branch.join.accessProfileFitM is not None
    unchanged = (station >= branch.leave.accessProfileFitM) & (
        station <= source["lengthM"] - branch.join.accessProfileFitM
    )
    assert np.any(unchanged)
    assert np.array(data["y"])[unchanged] == pytest.approx(
        np.array(old[branch.id]["samples"]["data"]["y"])[unchanged]
    )
    assert data["y"][0] == data["y"][-1] == 20
    assert data["grade"][0] == data["grade"][-1] == 0
    connectors = {f"{cfg.id}-{branch.tag}-{suffix}" for suffix in ("in", "out", "traffic-in")}
    for rid, road in new.items():
        if rid not in {branch.id, *connectors}:
            assert road == old[rid]
        assert {k: v for k, v in road.items() if k != "samples"} == {
            k: v for k, v in old[rid].items() if k != "samples"
        }
        for column in ("x", "z", "kappa"):
            assert road["samples"]["data"][column] == old[rid]["samples"]["data"][column]
        if rid in connectors:
            cols = road["samples"]["data"]
            for d in (-3, 0, 3):
                assert np.array(cols["y"]) - d * np.array(cols["bankRad"]) == pytest.approx(20)
    assert fitted.routes == original.routes
    assert fitted.network == original.network


@pytest.mark.parametrize("span", [1, 100_000])
def test_branch_fit_refuses_a_span_without_source_profile_on_both_sides(span: float) -> None:
    with pytest.raises(ValueError, match="accessProfileFitM must leave source profile"):
        bake_network(fitted_config(span, span), OSM, WAYS, land, "2026-10-02")


def test_branch_fit_refuses_overlapping_authored_spans() -> None:
    with pytest.raises(ValueError, match="branch profile fits must not overlap"):
        bake_network(fitted_config(1000, 1000), OSM, WAYS, land, "2026-10-02")


def test_branch_fit_requires_an_ordinary_traffic_enabled_junction() -> None:
    data = traffic_config().model_dump(exclude_none=True)
    data["branches"][0]["leave"]["accessProfileFitM"] = 80
    data["branches"][0].update(traffic="none", trafficIngress=None)
    with pytest.raises(ValidationError, match="accessProfileFitM needs a traffic-enabled ordinary branch"):
        NetworkConfig.model_validate(data)
    data["branches"][0].update(traffic="road", trafficIngress=traffic_config().branches[0].trafficIngress)
    data["branches"][0]["leave"].update(
        synthetic=True,
        turnRadiusM=40,
        turnDeg=20,
        straightM=80,
        toOffsetM=0,
    )
    with pytest.raises(ValidationError, match="accessProfileFitM needs a traffic-enabled ordinary branch"):
        NetworkConfig.model_validate(data)


@pytest.mark.parametrize("at_start", [True, False])
def test_endpoint_fit_matches_the_declared_grade_and_keeps_source_past_its_span(at_start: bool) -> None:
    pc = curve_piece(
        "approach",
        "approach",
        (0, 10, 0, 0),
        (0, 16, -200, 0),
        Shape(0, 0, 0, 10, 180, 10),
        4,
        2,
        20,
        [],
    )
    station = np.linspace(0, 200, len(pc.y))
    pc.y = 10 + station * 0.03
    original = pc.y.copy()
    span = 80
    fit_endpoint_profile(pc, span, 12, at_start, -0.01)
    end, adj, sign = (0, 1, 1) if at_start else (-1, -2, -1)
    assert pc.y[end] == 12
    assert (pc.y[adj] - pc.y[end]) / abs(station[adj] - station[end]) * sign == pytest.approx(-0.01)
    distance = station if at_start else 200 - station
    assert pc.y[distance >= span] == pytest.approx(original[distance >= span])
