"""Population read-outs. Rates always come from a sliding spike-count window,
never instantaneous spikes: at ~30 Hz most wedges are silent on any given
tick, so an instantaneous population vector is noise.

Headings are in wedge units, in [0, n_wedges). Increasing = counterclockwise.
"""
import numpy as np


def rate_series(spike_history, window=50, dt_ms=1.0):
    """Sliding-window rate (Hz) at every tick.

    spike_history: (T, N) bool. Returns (T, N); row t is the rate over ticks
    (t - window, t]. Ticks before the start of the history count as silent
    (always divided by the full window), so early rates are never inflated.
    """
    h = np.asarray(spike_history, dtype=float)
    c = np.vstack([np.zeros((1, h.shape[1])), np.cumsum(h, axis=0)])
    t = np.arange(1, h.shape[0] + 1)
    counts = c[t] - c[np.maximum(t - window, 0)]
    return counts * (1000.0 / (window * dt_ms))


def rates(spike_history, window=50, dt_ms=1.0):
    """Hz per neuron over the last `window` ticks of spike_history (T, N)."""
    return rate_series(spike_history, window, dt_ms)[-1]


def wedge_rates(rate_epg, wedge_epg, n_wedges):
    """Mean EPG rate per wedge, over the last axis. EPG must be ordered by wedge with no empty
    wedge (every Connectome is). With one EPG per wedge this is the identity, bit for bit."""
    starts = np.searchsorted(wedge_epg, np.arange(n_wedges))
    sizes = np.diff(np.append(starts, len(wedge_epg)))
    if np.any(sizes == 0) or np.any(np.diff(wedge_epg) < 0):
        raise ValueError("wedge_rates: EPG must be sorted by wedge with no empty wedge")
    return np.add.reduceat(np.asarray(rate_epg, dtype=float), starts, axis=-1) / sizes


def heading(rate_epg, n_wedges):
    """Population vector over the last axis -> (wedge_float, strength).

    R = sum_i rate_i * exp(1j*theta_i); heading = (angle(R) mod 2pi) * n_wedges / 2pi,
    strength = |R| / (sum rate + 1e-9). Works on (n_wedges,) or (T, n_wedges).
    """
    r = np.asarray(rate_epg, dtype=float)
    theta = 2 * np.pi * np.arange(n_wedges) / n_wedges
    R = r @ np.exp(1j * theta)
    wedge = np.mod(np.angle(R), 2 * np.pi) * n_wedges / (2 * np.pi)
    strength = np.abs(R) / (r.sum(axis=-1) + 1e-9)
    return wedge, strength


BUMP_FLOOR_HZ = 15.0  # smoothed peak below this is "no bump" (one spike per 50-tick window is 20 Hz)


def bump_count(rate_epg):
    """Number of circular runs of adjacent wedges above half-peak, on the ring
    smoothed circularly with a [1,2,1]/4 kernel.

    Window rates come in one-spike steps (20 Hz at 50 ticks), so a single bump
    often shows a one-wedge dip below half-peak (e.g. 40,60,20,40,20) and a
    dying ring leaves isolated single spikes (20,0,20). The smoothing stops such
    jitter splitting one run in two; a real second bump, separated by silent
    wedges, still counts. A smoothed peak under BUMP_FLOOR_HZ, or a ring
    entirely above half-peak (no bounded bump), returns 0.
    """
    r = np.asarray(rate_epg, dtype=float)
    s = (np.roll(r, 1) + 2 * r + np.roll(r, -1)) / 4
    peak = s.max()
    if peak < BUMP_FLOOR_HZ:
        return 0
    above = s > 0.5 * peak
    if above.all():
        return 0
    return int(np.count_nonzero(above & ~np.roll(above, 1)))  # rising edges round the ring


def unwrap(headings, n_wedges):
    """Remove wrap-around so a step from n_wedges-0.5 to 0.5 reads as +1, not -(n_wedges-1)."""
    return np.unwrap(np.asarray(headings, dtype=float), period=n_wedges)


def drift(headings, n_wedges):
    """Net drift in wedges per 1000 ticks, for one heading sample per tick (unwrapped first)."""
    u = unwrap(headings, n_wedges)
    if u.size < 2:
        return 0.0
    return float((u[-1] - u[0]) / (u.size - 1) * 1000.0)
