"""Tests of the fly_brain instruction bytes (chain_tx.py).

The round trip that matters: bytes this module builds are decoded by the program's ABI
(`thru abi reflect`) back into the manifest row they came from. If the C structs, the ABI and this
encoder ever disagree, this fails rather than the chain.
"""
import json
import os
import re
import shutil
import subprocess

import pytest

import chain_tx
import derive_cx

CHAIN = os.path.normpath(os.path.join(chain_tx.HERE, "..", "chain"))
ABI = os.path.join(CHAIN, "fly_brain.abi.yaml")
HEADER = os.path.join(CHAIN, "examples", "tn_fly_brain.h")
GENERATED = os.path.join(CHAIN, "generated", "c", "org", "flybrain", "chain", "types.h")
pytestmark = pytest.mark.skipif(not os.path.exists(os.path.join(chain_tx.DATA, "chain_manifest.npz")),
                                reason="chain manifest missing (python/chain_manifest.py)")


@pytest.fixture(scope="module")
def m():
    return chain_tx.load_manifest()


def thru_cmd():
    """The thru CLI as an argv prefix (on Windows it is a .cmd shim, which needs cmd /c)."""
    exe = shutil.which("thru")
    return (["cmd", "/c", exe] if exe and exe.lower().endswith(".cmd") else [exe]) if exe else None


def reflect(payload, tmp_path, type_name="FlyBrainInstruction"):
    """Decode instruction bytes with the program's own ABI; values only, as plain Python."""
    path = tmp_path / "payload.bin"
    path.write_bytes(payload)
    out = subprocess.run(thru_cmd() + ["abi", "reflect", "-f", ABI, "-t", type_name, "-d", str(path),
                                       "--json", "--values-only", "--quiet"],
                         capture_output=True, text=True, check=True)

    def strip(node):
        if isinstance(node, dict):
            if set(node) == {"type", "value"}:
                return node["value"]
            if "variant" in node and "value" in node:
                return {node["variant"]: strip(node["value"])}
            if set(node) == {"target", "value"}:
                return strip(node["value"])
            return {k: strip(v) for k, v in node.items()}
        if isinstance(node, list):
            return [strip(v) for v in node]
        return node

    return strip(json.loads(out.stdout))


def test_plan_counts_the_manifest(m):
    p = chain_tx.plan(m)
    assert p["create_neuron"] == len(m["wallet_body_id"]) == 134
    assert p["add_synapse"] == len(m["syn_pre"]) == 114854
    assert p["transactions"] == 1 + 134 + 114854
    assert p["state_proofs_needed"] == 135          # only account creation needs a proof


def test_payload_sizes_match_the_c_structs(m):
    """sizeof(tn_fly_*_args_t) in chain/examples/tn_fly_brain.h, plus the proof bytes."""
    s = chain_tx.samples(m)
    assert len(s["create_brain"]) == 114 + 104
    assert len(s["create_neuron"]) == 60 + 104
    assert len(s["add_synapse"]) == 56


@pytest.mark.skipif(shutil.which("thru") is None, reason="the thru CLI is not installed")
def test_add_synapse_bytes_reflect_back_to_their_manifest_row(m, tmp_path):
    for row in (0, 1, 12345, len(m["syn_pre"]) - 1):
        i, pre, post, pre_body, post_body, pre_xyz, post_xyz = next(chain_tx.synapse_rows(m, start=row))
        got = reflect(chain_tx.add_synapse(2, pre, post, i, pre_body, post_body, pre_xyz, post_xyz), tmp_path)
        assert got["instruction_type"] == chain_tx.ADD_SYNAPSE
        args = got["args"]["AddSynapse"]
        assert args["index"] == i and args["pre_index"] == pre and args["post_index"] == post
        assert args["pre_body_id"] == pre_body and args["post_body_id"] == post_body
        assert args["pre_xyz"] == [int(v) for v in pre_xyz] and args["post_xyz"] == [int(v) for v in post_xyz]


@pytest.mark.skipif(shutil.which("thru") is None, reason="the thru CLI is not installed")
def test_create_neuron_and_brain_bytes_reflect_back(m, tmp_path):
    i, body, cls, wedge, sign, seed_text = next(chain_tx.neuron_rows(m))
    got = reflect(chain_tx.create_neuron(2, 3, i, body, cls, wedge, sign, proof=b"\x07" * 104), tmp_path)
    args = got["args"]["CreateNeuron"]
    assert got["instruction_type"] == chain_tx.CREATE_NEURON and args["body_id"] == body
    assert args["cls"] == chain_tx.CLS[cls] and args["wedge"] == wedge and args["sign"] == sign
    assert bytes(args["seed"]) == chain_tx.seed(seed_text) and args["proof_size"] == 104

    authority = bytes(range(32))
    got = reflect(chain_tx.create_brain(2, authority, 134, 114854, proof=b"\x07" * 104), tmp_path)
    args = got["args"]["CreateBrain"]
    assert bytes(args["manifest_sha256"]) == chain_tx.manifest_hash()
    assert bytes(args["authority"]) == authority
    assert args["neuron_total"] == 134 and args["synapse_total"] == 114854


C_TYPES = {"uchar": "uint8_t", "ushort": "uint16_t", "uint": "uint32_t", "ulong": "uint64_t",
           "tn_schar": "int8_t", "int": "int32_t", "long": "int64_t"}
# handwritten struct -> (generated type, how many leading fields the generated body does not repeat,
# because they are the tag in its parent: the instruction type, or an account's/event's version+kind)
MIRRORS = {
    "tn_fly_create_brain_args_t": ("CreateBrainArgs", 1),
    "tn_fly_create_neuron_args_t": ("CreateNeuronArgs", 1),
    "tn_fly_add_synapse_args_t": ("AddSynapseArgs", 1),
    "tn_fly_brain_account_t": ("BrainAccountBody", 2),
    "tn_fly_neuron_account_t": ("NeuronAccountBody", 2),
    "tn_fly_brain_created_event_t": ("BrainCreatedBody", 2),
    "tn_fly_neuron_created_event_t": ("NeuronCreatedBody", 2),
    "tn_fly_synapse_added_event_t": ("SynapseAddedBody", 2),
}


C_CONSTANTS = {"TN_SEED_SIZE": 32}          # array sizes the header writes as names


def c_fields(body):
    """[(name, type, array size)] of a C struct body; comments and flexible array members ignored."""
    out = []
    for line in re.sub(r"/\*.*?\*/", "", body, flags=re.S).splitlines():
        hit = re.match(r"\s*(\w+)\s+(\w+)\s*(?:\[(\w*)\])?\s*;", line)
        if not hit:
            continue
        ctype, name, size = hit.groups()
        if size == "":                      # uint8_t proof[]: the flexible array member, sized by proof_size
            continue
        if size is None:
            count = 1
        elif size.isdigit():
            count = int(size)
        else:
            assert size in C_CONSTANTS, f"unknown array size {size} on {name}"
            count = C_CONSTANTS[size]
        out.append((name, C_TYPES.get(ctype, ctype), count))
    return out


def test_handwritten_structs_mirror_the_generated_abi_types():
    """The program compiles against chain/examples/tn_fly_brain.h, while the ABI (and everything
    generated or reflected from it) describes chain/generated. If those two drift apart, only the
    chain disagrees with the program and every other test still passes, so compare them here."""
    hand = {name: c_fields(body) for body, name in re.findall(
        r"typedef struct __attribute__\(\(packed\)\) \{(.*?)\n\}\s*(\w+);",
        open(HEADER, encoding="utf-8").read(), flags=re.S)}
    gen = {name: c_fields(body) for name, body in re.findall(
        r"struct\s+__attribute__\(\(packed\)\)\s+(\w+)\s*\{(.*?)\n\};",
        open(GENERATED, encoding="utf-8").read(), flags=re.S)}
    assert set(MIRRORS) <= set(hand), f"missing from the header: {sorted(set(MIRRORS) - set(hand))}"
    for name, (generated_name, skip) in MIRRORS.items():
        assert generated_name in gen, f"{generated_name} missing from the generated ABI types"
        assert hand[name][skip:] == gen[generated_name], (name, hand[name][skip:], gen[generated_name])


def test_class_codes_match_the_derivation():
    """chain_tx.CLS, TN_FLY_CLS_* and derive_cx.CLASSES must agree, or neurons land as the wrong class."""
    assert list(chain_tx.CLS) == list(derive_cx.CLASSES)
    assert list(chain_tx.CLS.values()) == list(range(len(derive_cx.CLASSES)))
    header = open(HEADER, encoding="utf-8").read()
    for name, code in chain_tx.CLS.items():
        assert re.search(rf"#define TN_FLY_CLS_{name}\s+\(\(uchar\){code}U\)", header), name


def test_seeds_are_unique_and_fit(m):
    seeds = {chain_tx.seed(s) for *_, s in chain_tx.neuron_rows(m)}
    assert len(seeds) == len(m["wallet_body_id"])          # one account per neuron
    assert all(len(s) == chain_tx.SEED_SIZE for s in seeds)
    assert chain_tx.seed(chain_tx.BRAIN_SEED) not in seeds  # ...and none collides with the brain's


def test_rows_resume_from_the_on_chain_counts(m):
    """Resuming is 'start at the brain account's counts', so both row iterators take a start."""
    assert next(chain_tx.neuron_rows(m, start=7))[0] == 7
    assert next(chain_tx.synapse_rows(m, start=1000))[0] == 1000
    assert len(list(chain_tx.neuron_rows(m, start=134))) == 0
