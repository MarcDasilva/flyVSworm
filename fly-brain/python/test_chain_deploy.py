"""Tests of the deployment record (chain_deploy.py).

Offline only: these check that the record matches this checkout. Whether the chain matches it is
`python chain_deploy.py --on-chain`, which needs the network and the deployed program.
"""
import json
import os

import pytest

import chain_deploy

pytestmark = pytest.mark.skipif(not os.path.exists(chain_deploy.RECORD),
                                reason="no deployment record (python chain_deploy.py --write ...)")


@pytest.fixture(scope="module")
def record():
    with open(chain_deploy.RECORD) as f:
        return json.load(f)


@pytest.mark.skipif(not os.path.exists(chain_deploy.BINARY),
                    reason="the program binary is not built (see chain/GNUmakefile)")
def test_record_matches_the_built_binary_and_sources():
    """Fails if the program was rebuilt, or the ABI or C sources edited, without re-recording:
    otherwise the record would still claim to describe what is deployed."""
    assert chain_deploy.verify() == []


def test_record_pins_what_the_program_is_fed(record):
    assert record["inputs"] == chain_deploy.content_hashes()   # manifest and weight table hashes


def test_record_has_the_chain_addresses_and_no_secrets(record):
    for field in ("network", "rpc", "program", "brain", "authority"):
        assert record.get(field), f"{field} missing from the record"
    assert record["program"] != record["brain"]
    flat = json.dumps(record)
    assert "key" not in flat.lower() or "pubkey" in flat.lower()  # public addresses only, never key material
    assert record["program_binary"]["bytes"] > 0
