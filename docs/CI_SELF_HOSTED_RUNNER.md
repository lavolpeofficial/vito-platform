# VITO self-hosted CI runner

VITO CI runs on the dedicated GitHub Actions runner label set:

`self-hosted, linux, x64, aoe-heavy`

This keeps verification compute on the LA VOLPE Hetzner node while GitHub remains the source and governance plane.

The existing `aoe-governance` runner is a separate trust/role boundary and must not be reused for VITO build/test workloads.
