"""Shared multi-device world scenario seed (synthetic, illustrative).

One world, one clock, one network graph: a ship with onboard clients, an
aircraft with cabin clients, a connected car with a passenger phone, a
pedestrian and a laptop share terrestrial and satellite infrastructure,
plus an airport terminal network and the underserved Saltmeadow Settlement
(local Wi-Fi, deliberately no backhaul).

Coordinates follow the unified Port Meridian frame (see region.py):
km, x = east, y = north, coast near y=0, origin at the harbor mouth.
All costs/latencies/bandwidths are illustrative planning values.
"""

from .models import Topology


def _node(nid, ntype, label, pos2d, world, techs=(), dev=None, mob=None, props=None):
    node: dict = {
        "id": nid, "type": ntype, "label": label,
        "position": {"x": pos2d[0], "y": pos2d[1]},
        "world_position": {"x_km": world[0], "y_km": world[1],
                           "altitude_m": world[2] if len(world) > 2 else 0.0},
        "supported_technologies": list(techs),
        "properties": dict(props or {"note": "synthetic example"}),
    }
    if dev:
        node["device_id"] = dev
    if mob:
        node["mobility"] = mob
    return node


def _mob(vx=0.0, vy=0.0, follow=None, waypoints=(), speed=0.0):
    spec: dict = {"velocity_x_kmh": vx, "velocity_y_kmh": vy,
                  "waypoints_km": [list(w) for w in waypoints], "speed_kmh": speed}
    if follow:
        spec["follow"] = follow
    return spec


def _link(lid, src, dst, label, tech, medium, lat, bw, rel, cost, status="active",
          rf=None, max_range=None):
    link: dict = {
        "id": lid, "source": src, "target": dst, "label": label,
        "latency_ms": lat, "bandwidth_mbps": bw, "reliability": rel,
        "cost_per_gb": cost, "status": status,
        "technology": tech, "medium": medium,
    }
    if rf:
        link["rf"] = rf
    if max_range is not None:
        link["max_range_km"] = max_range
    return link


def build_shared_world_topology() -> Topology:
    lte = {"model": "link_budget", "preset": "lte_uplink"}
    nodes = [
        # -- fixed terrestrial infrastructure --
        _node("city-bs", "base_station", "Coastal Base Station", (300, 90), (-6, -3, 60),
              ["Cellular (LTE)", "Fiber"], "gen-basestation-lte-01",
              props={"role": "terrestrial access"}),
        _node("bs-east", "base_station", "East Base Station", (620, 90), (20, -4, 40),
              ["Cellular (LTE)", "Fiber"], "gen-basestation-lte-01",
              props={"role": "terrestrial access"}),
        _node("town-wifi", "access_point", "Town Hotspot", (460, 130), (2, -2, 10),
              ["Wi-Fi", "Fiber"], "gen-wifi-ap-01",
              props={"role": "local access"}),
        _node("sat-ground", "ground_station", "Satellite Gateway", (140, 130), (-10, -6, 10),
              ["Ka-band feeder", "Fiber"], "gen-sat-gateway-01",
              props={"role": "satellite backhaul"}),
        _node("core-1", "core", "Core / Backhaul", (300, 220), (-8, -12, 0),
              ["Fiber"], "gen-switch-24p-01",
              props={"role": "aggregation core"}),
        _node("internet-1", "internet", "Internet", (300, 330), (-14, -14, 0)),
        _node("sat-geo-1", "satellite", "GEO Satellite (rep.)", (140, 40), (0, 60),
              ["VSAT (GEO)", "Ka-band feeder"],
              props={"role": "bent-pipe relay abstraction"}),
        # -- ship cluster (sails offshore, +y) --
        _node("ship-1", "ship", "Vessel", (60, 420), (-2, 12),
              ["Ethernet"], "gen-ship-comms-01",
              _mob(waypoints=[(4, 55), (-2, 12)], speed=25.0),
              {"role": "mobile endpoint"}),
        _node("ship-phone", "phone", "Ship Phone", (180, 470), (-2, 12),
              ["Wi-Fi"], "gen-smartphone-01", _mob(follow="ship-1"),
              {"role": "onboard client", "traffic": "video_call"}),
        _node("ship-ap", "access_point", "Ship Wi-Fi", (60, 520), (-2, 12),
              ["Wi-Fi", "Ethernet"], "gen-wifi-ap-01", _mob(follow="ship-1"),
              {"role": "onboard access"}),
        _node("ship-router", "router", "Ship Router", (180, 570), (-2, 12),
              ["Ethernet"], "gen-router-branch-01", _mob(follow="ship-1"),
              {"role": "onboard gateway stack"}),
        _node("ship-cell", "gateway", "Ship LTE Modem", (300, 520), (-2, 12),
              ["Ethernet", "Cellular (LTE)"], "gen-gateway-multiwan-01",
              _mob(follow="ship-1"), {"role": "cellular uplink"}),
        _node("ship-sat", "gateway", "Ship VSAT Terminal", (300, 470), (-2, 12),
              ["Ethernet", "VSAT (GEO)"], "gen-vsat-maritime-01",
              _mob(follow="ship-1"), {"role": "satellite uplink"}),
        # -- aircraft cluster (flies east, +x, 10 km alt) --
        _node("aircraft-1", "aircraft", "Airliner", (560, 420), (-30, 25, 10000),
              ["Ethernet"], "gen-aircraft-term-01",
              _mob(waypoints=[(45, 25), (-45, 25)], speed=450.0),
              {"role": "mobile endpoint"}),
        _node("plane-phone", "phone", "Cabin Phone", (680, 470), (-30, 25, 10000),
              ["Wi-Fi"], "gen-smartphone-01", _mob(follow="aircraft-1"),
              {"role": "cabin client"}),
        _node("plane-ap", "access_point", "Cabin Wi-Fi", (560, 520), (-30, 25, 10000),
              ["Wi-Fi", "Ethernet"], "gen-wifi-ap-01", _mob(follow="aircraft-1"),
              {"role": "cabin access"}),
        _node("plane-sat", "gateway", "Aircraft SATCOM", (680, 570), (-30, 25, 10000),
              ["Ethernet", "VSAT (GEO)"], "gen-aircraft-term-01",
              _mob(follow="aircraft-1"), {"role": "satellite uplink"}),
        # -- car cluster (drives east along the coast road) --
        _node("car-1", "car", "Connected Car", (380, 620), (-25, -4),
              ["Wi-Fi"], "gen-car-gateway-01",
              _mob(waypoints=[(28, -4), (-25, -4)], speed=55.0),
              {"role": "mobile endpoint"}),
        _node("car-hotspot", "gateway", "Car Hotspot", (500, 620), (-25, -4),
              ["Wi-Fi", "Cellular (LTE)"], "gen-car-gateway-01", _mob(follow="car-1"),
              {"role": "vehicle uplink"}),
        _node("car-phone", "phone", "Passenger Phone", (440, 670), (-25, -4),
              ["Wi-Fi"], "gen-smartphone-01", _mob(follow="car-1"),
              {"role": "passenger client", "traffic": "voice"}),
        # -- pedestrian + laptop near the town hotspot --
        _node("walker-1", "person", "Pedestrian", (560, 180), (2, -2),
              ["Wi-Fi", "Cellular (LTE)"], "gen-smartphone-01", None,
              {"role": "pedestrian client", "traffic": "voice"}),
        _node("laptop-1", "laptop", "Field Laptop", (660, 180), (2, -2),
              ["Wi-Fi"], "gen-laptop-01", None,
              {"role": "portable client", "traffic": "file_transfer"}),
        # -- second city cell (live backhaul, idle radio in this experiment) --
        _node("city-bs-2", "base_station", "South City Cell", (300, 150), (4, -10, 40),
              ["Cellular (LTE)", "Fiber"], "gen-basestation-lte-01",
              props={"role": "terrestrial access"}),
        # -- airport ground network --
        _node("airport-ap", "access_point", "Terminal Wi-Fi", (700, 130), (42, -6.5, 12),
              ["Wi-Fi", "Fiber"], "gen-wifi-ap-01",
              props={"role": "airport access"}),
        # -- Saltmeadow Settlement (underserved rural; local Wi-Fi, no backhaul) --
        _node("rural-ap", "access_point", "School Hotspot", (60, 660), (-40, -20, 8),
              ["Wi-Fi"], "gen-wifi-ap-01",
              props={"role": "isolated access", "coverage_region": "coastal-fishing",
                     "note": "synthetic example: no uplink by design"}),
        _node("rural-phone-1", "phone", "Saltmeadow Phone A", (140, 710), (-40.2, -20.2),
              ["Wi-Fi"], "gen-smartphone-01", None,
              {"role": "rural client", "traffic": "messaging"}),
        _node("rural-phone-2", "phone", "Saltmeadow Phone B", (220, 710), (-39.8, -20.3),
              ["Wi-Fi"], "gen-smartphone-01", None,
              {"role": "rural client", "traffic": "messaging"}),
    ]
    links = [
        # fixed backhaul
        _link("link-citybs-core", "city-bs", "core-1", "Fiber backhaul",
              "Fiber", "wired", 2, 10000, 0.999, 0.02),
        _link("link-eastbs-core", "bs-east", "core-1", "Fiber backhaul",
              "Fiber", "wired", 4, 10000, 0.999, 0.02),
        _link("link-townwifi-core", "town-wifi", "core-1", "Fiber uplink",
              "Fiber", "wired", 2, 1000, 0.999, 0.02),
        _link("link-satground-core", "sat-ground", "core-1", "Teleport fiber",
              "Fiber", "wired", 2, 2000, 0.999, 0.05),
        _link("link-core-internet", "core-1", "internet-1", "Upstream",
              "Fiber", "wired", 5, 20000, 0.999, 0.02),
        _link("link-sat-feeder", "sat-geo-1", "sat-ground", "Ka feeder",
              "Ka-band feeder", "wireless", 250, 500, 0.995, 0.5,
              status="active"),
        # ship onboard + uplinks
        _link("link-shipphone-ap", "ship-phone", "ship-ap", "Onboard Wi-Fi",
              "Wi-Fi", "wireless", 3, 600, 0.999, 0.0, max_range=0.3),
        _link("link-shipap-router", "ship-ap", "ship-router", "LAN",
              "Ethernet", "wired", 1, 1000, 0.9999, 0.0),
        _link("link-ship-router", "ship-1", "ship-router", "Avionics LAN",
              "Ethernet", "wired", 1, 1000, 0.9999, 0.0),
        _link("link-shiprouter-cell", "ship-router", "ship-cell", "LAN",
              "Ethernet", "wired", 1, 1000, 0.9999, 0.0),
        _link("link-shiprouter-sat", "ship-router", "ship-sat", "LAN",
              "Ethernet", "wired", 1, 100, 0.9999, 0.0),
        _link("link-shipcell-bs", "ship-cell", "city-bs", "LTE uplink",
              "Cellular (LTE)", "wireless", 35, 75, 0.93, 0.5, rf=lte),
        _link("link-shipsat-geo", "ship-sat", "sat-geo-1", "VSAT uplink",
              "VSAT (GEO)", "wireless", 500, 25, 0.97, 8.0),
        # aircraft onboard + uplink (satellite only: no aviation LTE modeled)
        _link("link-planephone-ap", "plane-phone", "plane-ap", "Cabin Wi-Fi",
              "Wi-Fi", "wireless", 3, 600, 0.999, 0.0, max_range=0.3),
        _link("link-planeap-sat", "plane-ap", "plane-sat", "LAN",
              "Ethernet", "wired", 1, 1000, 0.9999, 0.0),
        _link("link-aircraft-ap", "aircraft-1", "plane-ap", "Avionics LAN",
              "Ethernet", "wired", 1, 1000, 0.9999, 0.0),
        _link("link-planesat-geo", "plane-sat", "sat-geo-1", "SATCOM uplink",
              "VSAT (GEO)", "wireless", 500, 40, 0.97, 10.0),
        # car + hotspot
        _link("link-car-hotspot", "car-1", "car-hotspot", "In-car Wi-Fi",
              "Wi-Fi", "wireless", 3, 300, 0.999, 0.0, max_range=0.1),
        _link("link-carphone-hotspot", "car-phone", "car-hotspot", "In-car Wi-Fi",
              "Wi-Fi", "wireless", 3, 300, 0.999, 0.0, max_range=0.1),
        _link("link-hotspot-west", "car-hotspot", "city-bs", "LTE west",
              "Cellular (LTE)", "wireless", 35, 80, 0.93, 0.4, rf=lte),
        _link("link-hotspot-east", "car-hotspot", "bs-east", "LTE east",
              "Cellular (LTE)", "wireless", 35, 80, 0.93, 0.4, rf=lte),
        # pedestrian + laptop
        _link("link-walker-wifi", "walker-1", "town-wifi", "Hotspot Wi-Fi",
              "Wi-Fi", "wireless", 3, 400, 0.99, 0.0, max_range=0.3),
        _link("link-walker-lte", "walker-1", "city-bs", "Direct LTE",
              "Cellular (LTE)", "wireless", 35, 60, 0.93, 0.4,
              status="standby", rf=lte),
        _link("link-laptop-wifi", "laptop-1", "town-wifi", "Hotspot Wi-Fi",
              "Wi-Fi", "wireless", 3, 400, 0.99, 0.0, max_range=0.3),
        # second city cell + airport backhaul (wired; radio idle here)
        _link("link-citybs2-core", "city-bs-2", "core-1", "Fiber backhaul",
              "Fiber", "wired", 2, 10000, 0.999, 0.02),
        _link("link-airport-core", "airport-ap", "core-1", "Airport fiber",
              "Fiber", "wired", 6, 10000, 0.999, 0.03),
        # rural settlement: local Wi-Fi only, deliberately no uplink
        _link("link-rural-a-ap", "rural-phone-1", "rural-ap", "School Wi-Fi",
              "Wi-Fi", "wireless", 3, 200, 0.99, 0.0, max_range=0.5),
        _link("link-rural-b-ap", "rural-phone-2", "rural-ap", "School Wi-Fi",
              "Wi-Fi", "wireless", 3, 200, 0.99, 0.0, max_range=0.5),
    ]
    return Topology.model_validate({
        "metadata": {
            "name": "Shared World",
            "description": "Synthetic multi-device world: ship, aircraft, car, pedestrian "
                           "and laptop sharing terrestrial + satellite infrastructure. "
                           "All values illustrative.",
            "synthetic": True,
            "version": 1,
            "environment": "shared_world",
        },
        "nodes": nodes,
        "links": links,
    })
