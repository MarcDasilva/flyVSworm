"""Diagnostic figures: the weight-matrix gate and the 4-panel reference run."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm

import metrics

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e4e3df"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]  # categorical slots 1-3, fixed order
BLUES = LinearSegmentedColormap.from_list("seq_blue", ["#cde2fb", "#86b6ef", "#2a78d6", "#184f95", "#0d366b"])
DIVERGING = LinearSegmentedColormap.from_list("div", ["#2a78d6", "#f0efec", "#e34948"])  # neg=blue, pos=red

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "text.color": INK, "axes.labelcolor": INK_2, "xtick.color": INK_2, "ytick.color": INK_2,
    "axes.edgecolor": GRID, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False, "font.size": 9,
})


def plot_weights(cx, path):
    """Left: the EPG->EPG block (the gate: a diagonal band that wraps at the corners).
    Right: the full signed W with population boundaries."""
    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 5), gridspec_kw={"width_ratios": [1, 1.15]})
    E = cx.W[cx.idx["EPG"], cx.idx["EPG"]]
    im = a.imshow(E, cmap=BLUES, vmin=0, interpolation="nearest")
    a.set_title("EPG → EPG  (W[pre, post])", loc="left")
    a.set_xlabel("post: EPG wedge"); a.set_ylabel("pre: EPG wedge"); a.grid(False)
    fig.colorbar(im, ax=a, fraction=0.046, pad=0.04, label="weight")

    lim = np.abs(cx.W).max()
    im = b.imshow(cx.W, cmap=DIVERGING, norm=TwoSlopeNorm(0, -lim, lim), interpolation="nearest")
    b.set_title("Full W  (red excitatory, blue inhibitory)", loc="left")
    b.set_xlabel("post"); b.set_ylabel("pre"); b.grid(False)
    ids = [np.arange(cx.N)[sl] for sl in cx.idx.values()]  # works for slices or index arrays
    ticks = [(g.min() + g.max()) / 2 for g in ids]
    for g in ids:
        for f in (b.axhline, b.axvline):
            f(g.min() - 0.5, color=INK_2, lw=0.6)
    b.set_xticks(ticks, cx.idx.keys()); b.set_yticks(ticks, cx.idx.keys())
    fig.colorbar(im, ax=b, fraction=0.046, pad=0.04, label="weight")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def _short(label, inp):
    """Compact phase name for the phase strip, e.g. 'T2 hold' or 'T3 ±0.0207'."""
    name = label.split(" ")[0]
    if inp.drive_pen_l and inp.drive_pen_r == -inp.drive_pen_l:
        return f"{name} ±{inp.drive_pen_l:.3g}"
    return label.split("=")[0].split(",")[0]


def plot_reference(run, path, title):
    cx, n = run.cx, run.cx.n_wedges
    T = run.spikes.shape[0]
    t = np.arange(1, T + 1)
    fig = plt.figure(figsize=(12, 14))
    gs = fig.add_gridspec(6, 2, height_ratios=[0.22, 1.3, 1.1, 0.8, 0.55, 1.7], width_ratios=[1, 0.025],
                          hspace=0.12, wspace=0.03, top=0.97)
    strip = fig.add_subplot(gs[0, 0])
    ax1 = fig.add_subplot(gs[1, 0], sharex=strip)
    ax2 = fig.add_subplot(gs[2, 0], sharex=strip)
    cax = fig.add_subplot(gs[2, 1])
    ax3 = fig.add_subplot(gs[3, 0], sharex=strip)
    ax4 = fig.add_subplot(gs[5, :], projection="polar")
    strip.set_title(title, loc="left", fontsize=12, color=INK, pad=4)

    # phase strip: labels staggered over three rows so short neighbouring phases never collide
    strip.set_ylim(0, 1); strip.axis("off")
    for k, ((lab, a, z), inp) in enumerate(zip(run.phases, run.inputs)):
        strip.text(a + 12, (0.85, 0.5, 0.15)[k % 3], _short(lab, inp), ha="left", va="center",
                   fontsize=8, color=INK_2)
    for lab, a, z in run.phases:
        for ax in (strip, ax1, ax2, ax3):
            ax.axvline(a + 0.5, color=INK_2, lw=0.6, ls=":")

    # 1: EPG spike raster
    tt, ii = np.nonzero(run.spikes[:, cx.idx["EPG"]])
    ax1.scatter(tt + 1, ii, s=3, marker="|", color=INK, linewidths=0.6)
    ax1.set_ylim(-0.5, n - 0.5); ax1.set_ylabel("EPG wedge\n(spike raster)")

    # 2: heading, each sample coloured by bump strength (one axis; no second scale)
    alive = run.rates[:, cx.idx["EPG"]].sum(axis=1) > 0  # heading is undefined on a silent ring
    sc = ax2.scatter(t[alive], run.heading[alive], c=run.strength[alive], cmap=BLUES, vmin=0, vmax=1,
                     s=2, linewidths=0)
    ax2.set_ylim(0, n); ax2.set_ylabel("heading (wedge)\n↑ = CCW")
    fig.colorbar(sc, cax=cax, label="bump strength")

    # 3: input schedule. PEN drives as lines; the landmark (an order of magnitude
    # larger) as labelled shaded spans, so both stay readable on one axis.
    dl, dr = np.zeros(T), np.zeros(T)
    for (lab, a, z), inp in zip(run.phases, run.inputs):
        dl[a:z], dr[a:z] = inp.drive_pen_l, inp.drive_pen_r
        if inp.landmark_active:
            ax3.axvspan(a + 0.5, z + 0.5, color=SERIES[2], alpha=0.18, lw=0)
            ax3.text(a + 8, 0.97, f"landmark @ wedge {inp.landmark_wedge}\nI = {inp.landmark_current:g}",
                     transform=ax3.get_xaxis_transform(), va="top", fontsize=7.5, color=INK_2)
    ax3.step(t, dl, where="post", color=SERIES[0], lw=2, label="drive_pen_l")
    ax3.step(t, dr, where="post", color=SERIES[1], lw=2, label="drive_pen_r")
    ax3.axhline(0, color=INK_2, lw=0.6)
    lim = max(np.abs(dl).max(), np.abs(dr).max(), 1e-3) * 1.4
    ax3.set_ylim(-lim, lim)
    ax3.set_ylabel("PEN drive\n(current)"); ax3.set_xlabel("tick (1 tick = dt ms)")
    handles = ax3.get_legend_handles_labels()[0] + [plt.Rectangle((0, 0), 1, 1, color=SERIES[2], alpha=0.3)]
    ax3.legend(handles, ["drive_pen_l", "drive_pen_r", "landmark on"], loc="upper left", bbox_to_anchor=(0.12, 1.0),
               frameon=False, ncols=3, fontsize=8)
    strip.set_xlim(0, T)
    for ax in (strip, ax1, ax2):
        plt.setp(ax.get_xticklabels(), visible=False)

    # 4: final-state polar plot of the wedges (last rate window)
    r = run.rates[-1, cx.idx["EPG"]]
    theta = 2 * np.pi * np.arange(n) / n
    ax4.bar(theta, r, width=2 * np.pi / n * 0.85, color=SERIES[0], edgecolor=SURFACE, linewidth=2)
    h, s = metrics.heading(r, n)
    if r.sum() > 0:  # population-vector heading
        th = 2 * np.pi * h / n
        ax4.plot([th, th], [0, r.max() * 1.08], color=INK, lw=1.8, zorder=5)
        ax4.plot([th], [r.max() * 1.08], marker="o", ms=5, color=INK, zorder=5)
    ax4.set_ylim(0, max(r.max() * 1.12, 1.0))
    ax4.set_rlabel_position(360 / n * 4.5)  # radial labels between two wedge labels
    ax4.set_xticks(theta, [str(i) for i in range(n)])
    ax4.set_theta_zero_location("E"); ax4.set_theta_direction(1)  # CCW = increasing wedge index
    ax4.set_title(f"Final EPG rate by wedge (Hz, last rate window)  ·  heading {h:.2f} (line), strength {s:.2f}",
                  loc="center", fontsize=10, pad=18)

    fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)
