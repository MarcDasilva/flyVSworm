# Worm behavior readout

The readout opens when the worm is clicked, alongside its brain view; the **Worm readout** button provides keyboard and touch access. Hover only changes the cursor. Escape, the close button, or selecting another exhibit dismisses the readout. It uses the same on-chain motor state that drives the worm's body. It does not infer behavior from the rendered pixels or claim to be a trained biological classifier.

## Research and interpretation

| State | Supported interpretation | Display heuristic |
| --- | --- | --- |
| Forward | Head-led locomotion continuing a run | Buy tilt |
| Reverse | Backward locomotion that can precede reorientation | Sell tilt |
| Omega | Deep body bend and substantial heading change | Neutral |
| Pause | Low locomotor output in this simulation | Neutral |

Posture and its dynamics can distinguish forward, backward, turning and pause motifs. A classifier for real video would require tracked centerlines and validation against annotated recordings; the eigenworm approach provides one published basis. This implementation already has a motor-state source and does not reconstruct those labels from its own scripted animation. [Stephens et al., 2008](https://pmc.ncbi.nlm.nih.gov/articles/PMC2276863/)

Reversals and omega turns occur in normal navigation, including local search; their frequencies and sequences vary with food history. One reversal does not establish aversion, and one forward run does not establish attraction or a food-seeking goal. The readout therefore describes motor actions rather than assigning emotions or intent. [Gray, Hill & Bargmann, 2005](https://pmc.ncbi.nlm.nih.gov/articles/PMC546636/)

Command-interneuron involvement in directional locomotion is supported by circuit experiments. Our particular voltage normalization, weights, thresholds and dwell times are engineering choices in this simulation, not experimentally validated estimates of behavioral probability. [Chalfie et al., 1985](https://pubmed.ncbi.nlm.nih.gov/3981252/)

## Implementation

`program/worm.c:do_classify` supplies the motor state, forward drive and reverse drive. Forward drive weights AVBL/PVCL at 0.6/0.4; reverse drive weights AVAL/AVDL/AVEL at 0.5/0.3/0.2. Drive measures depolarization above each cell's stored resting voltage, clipped to a 20 mV full scale. The frontend retains the existing state machine's dwell and hysteresis.

The Buy/Sell mapping is an illustrative neural heuristic. Its slow baseline uses the motor state:

```text
FORWARD: max(0, forward_drive - reverse_drive)
REVERSE: min(0, forward_drive - reverse_drive)
PAUSE / OMEGA / unavailable playback: 0
```

`SynapticHeuristic` then measures confirmed currents involving those same five command cells. Chemical currents contribute the signed amount times the postsynaptic cell's weight. Electrical currents additionally subtract the donor's weight. Signed current and absolute current decay with a 450 ms time constant. The fast contribution is `signed / (absolute + 2)`; the displayed tilt combines 30% motor baseline with 70% current contribution. This can change direction before the slower motor-state classifier does. PAUSE, OMEGA and unavailable playback remain neutral. No random input or price movement affects the tilt.

The meter ranges from −1 (Sell) to +1 (Buy), with a neutral midpoint. Percentages express this heuristic's strength, never confidence or a forecast. The needle follows ten updates per second, with a 120 ms transition that respects reduced-motion preferences. The radial chart still shows the actual on-chain forward and reverse drives, with radius proportional to drive. Its arrow follows the front body segments; heading is measured from world +X toward +Z. It is not an angular probability distribution.

A bottom-center candlestick panel reads the same `TradingScreen.snapshot` as the room's existing demo market: 48 candles, each spanning 0.8 seconds of rendering time. Prices are simulated and labeled accordingly. The behavior, tilt and paper account fill the right readout without scrolling; both panels open and close together. A session-local `WormPortfolio` starts with $10,000 of paper cash, rebalances once per candle, and reports account value, total P&L, cash, shares and fill count. Positive tilt sets the invested fraction; negative tilt sells back to cash. Exposure is long-only, without leverage or trading fees. There are no brokerage orders, and faucet refills never count as trading profit.

Missing and malformed samples are distinct from biological Pause. In individual-transaction mode, fresh confirmed synapse receipts sustain continuous animation of the latest on-chain motor state. Neural time still advances independently and is shown by the simulation clock. After 15 seconds without new receipts or neural progress, the readout becomes stale and the gait stops. Re-reading the same behavior account or replaying a duplicate receipt does not renew activity. Sample age remains the age of the neural-state update, even while its synapses continue settling. The legacy batch mode retains simulation-time playback.

`web/src/test_classifier.ts` checks direction, strength, neutral states, conflicting drives, stale/missing playback, recovery, reset step zero, malformed inputs and signed-current responses. `web/src/test_portfolio.ts` checks cash/position accounting, mark-to-market P&L, closing exposure and invalid inputs. Run with `cd web && npm test`.
