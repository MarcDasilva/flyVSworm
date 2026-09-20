"""The stand-in Thru spike-block event: byte layout, round trip, and agreement with the live session."""
import os

import numpy as np
import pytest

import chain_event
import chain_server
import live

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
HEMI = os.path.exists(os.path.join(ROOT, "data", "cx_averaged.npz"))
READ = {"heading": 3.25, "strength": 0.71, "speed": -4.5, "position": -0.4, "level": 1.3}


def test_layout_puts_each_spike_in_its_documented_bit():
    n, first = 134, 500
    ev = chain_event.encode(first, 100, n, [(first + 7, 0), (first + 7, 133), (first + 99, 9)], READ, flags=2)
    rb = chain_event.row_bytes(n)
    assert rb == 17 and len(ev) == 12 + 100 * rb + 20
    assert ev[:12] == bytes([1, 1, 134, 0]) + (500).to_bytes(4, "little") + (100).to_bytes(2, "little") + (2).to_bytes(2, "little")
    bits = ev[12:12 + 100 * rb]
    assert bits[7 * rb + 0] == 0b1 and bits[7 * rb + 16] == 1 << 5 and bits[99 * rb + 1] == 1 << 1
    assert sum(bin(b).count("1") for b in bits) == 3


def test_round_trip_is_exact_for_spikes_and_q16_for_readouts():
    rng = np.random.default_rng(0)
    spikes = sorted({(int(1000 + t), int(i)) for t, i in zip(rng.integers(0, 100, 900), rng.integers(0, 134, 900))})
    d = chain_event.decode(chain_event.encode(1000, 100, 134, spikes, READ, flags=chain_event.FLAG_BOOT))
    assert d["spikes"] == spikes and d["first_tick"] == 1000 and d["n_ticks"] == 100 and d["flags"] == 1
    for k, v in READ.items():
        assert abs(d[k] - v) <= 0.5 / chain_event.Q


def test_q16_rounds_halves_to_even_and_saturates():
    q = chain_event.Q
    assert [chain_event.to_q16(x / q) for x in (0.5, 1.5, 2.5, -0.5, -1.5)] == [0, 2, 2, 0, -2]
    assert chain_event.to_q16(1e9) == 2 ** 31 - 1 and chain_event.to_q16(-1e9) == -(2 ** 31)


def test_rejects_spikes_outside_the_block_and_wrong_lengths():
    with pytest.raises(ValueError):
        chain_event.encode(100, 100, 134, [(200, 0)], READ)
    with pytest.raises(ValueError):
        chain_event.encode(100, 100, 134, [(150, 134)], READ)
    good = chain_event.encode(100, 100, 134, [], READ)
    with pytest.raises(ValueError):
        chain_event.decode(good[:-1])
    for offset, value in ((0, 2), (1, 7)):  # unknown version, unknown kind
        bad = bytearray(good)
        bad[offset] = value
        with pytest.raises(ValueError):
            chain_event.decode(bytes(bad))
    bad = bytearray(good)
    bad[12 + 16] |= 1 << 6  # neuron 134 of a 134-neuron row: a padding bit
    with pytest.raises(ValueError):
        chain_event.decode(bytes(bad))


@pytest.mark.skipif(not HEMI, reason="hemibrain data missing (run extract_hemibrain.py, then derive_cx.py)")
def test_blocks_carry_exactly_the_sessions_spikes_and_readouts():
    spec = os.path.join(ROOT, "spec", "params_hemibrain_avg.json")
    a = live.LiveSession(seed=3, spec_path=spec)
    b = live.LiveSession(seed=3, spec_path=spec)
    for _ in range(live.BOOT_TICKS // chain_server.BLOCK_TICKS + 3):  # boot blocks, then live bars
        first = a.t
        d = chain_event.decode(chain_server.block(a))
        frame = b.step(chain_server.BLOCK_TICKS)
        assert d["first_tick"] == first and d["n_neurons"] == b.cx.N
        assert d["spikes"] == sorted(map(tuple, frame["spikes"]))
        assert bool(d["flags"] & chain_event.FLAG_BOOT) == (first < live.BOOT_TICKS)
        assert bool(d["flags"] & chain_event.FLAG_LANDMARK) == (first == 0)  # the landmark covers block 0 only
        expected = {"heading": b.heading, "strength": b.strength, "speed": b.readout.speed,
                    "position": b.position, "level": b.mapper.level()}
        for k, v in expected.items():
            assert abs(d[k] - v) <= 0.5 / chain_event.Q, k


@pytest.mark.skipif(not HEMI, reason="hemibrain data missing (run extract_hemibrain.py, then derive_cx.py)")
def test_brain_info_maps_every_neuron_to_a_body_id_from_the_pinned_file():
    info = chain_server.brain_info(chain_server.SPEC)
    with np.load(os.path.join(ROOT, "data", "cx_averaged.npz"), allow_pickle=False) as f:
        assert info["body_id"] == [int(x) for x in f["body_id"]] and info["connectome"]["source"] == "hemibrain_averaged"
    assert info["n_neurons"] == 134 and len(set(info["body_id"])) == 134
