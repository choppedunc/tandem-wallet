# Admin Authorities

Tandem Wallet has two separate admin controls:

- Protocol authority: stored in the protocol config PDA. This wallet can update protocol fee bps, update the treasury USDC ATA, and transfer protocol authority.
- Program upgrade authority: stored in Solana's upgradeable loader ProgramData account. This wallet can deploy new program code while the program remains upgradeable.

## Current Mainnet Authority Split

Verified mainnet state as of 2026-05-20:

| Role | Address | Controls |
| --- | --- | --- |
| Program ID | `DLVHJQd8LUbypaoguREZ1sek4E7zeqPHYvw62KceFmQr` | Deployed Tandem Wallet program |
| ProgramData account | `FtgNJS8M4gHodFDoSztLtRG2ke1mqRgeYaj4rHHM8pPQ` | Upgradeable loader program data |
| Protocol config PDA | `GSwzqoB2XrHq9DiZ9TbchBCRedsv7riYS25jzjdfKd2R` | Protocol configuration account |
| Program upgrade authority | `5UfwNTQS7i2HT6jY1Erk3mYm8oAukZppFev8skGeCGUu` | Can upgrade deployed program code |
| Protocol authority | `95xraVuKuR61RaqppHb1hRC8qHs5eyKQC5PbN32qNta1` | Can update fee bps, treasury ATA, and protocol authority |
| Treasury wallet | `9qmyJeBqC8o6qarSw9dnz2xYsJz1eXeLv2bV9vRQXFGU` | Owner wallet for protocol fee receipts |
| Treasury USDC ATA | `BAmCR8daF4Rp21oxTv3eVPTM16QpFrPJdXWjAMLDtN6g` | Receives protocol USDC fees |
| TANDEM mint | `8naeAc6qBpZmesBtJB34TwX55MhVR8bBUMs4JayUpump` | Token-2022 TANDEM mint used for future staking |

The protocol authority and program upgrade authority intentionally differ. `npm run check-admin:devnet` can return `"status": "warning"` on mainnet for this reason. This warning is expected when the addresses above match the verified deployment state.

Do not document private keys, seed phrases, Helius URLs, RPC API keys, local keypair paths, or encrypted volume paths in this public repo.

## Fee Policy

The mainnet protocol fee is `25` bps, equal to `0.25%`.

Staking is disabled in the current vault-first launch. While there is no active staking, protocol fees route to the treasury. After staking is enabled and active stake exists, the intended fee model is 50% to active stakers and 50% to treasury.

## Risk Model

If protocol authority is compromised, the attacker cannot directly drain vault balances or approve proposals. They can change future fee settings and treasury routing, so vault activity after compromise can be economically redirected.

If program upgrade authority is compromised, the attacker can deploy malicious program code. This is a critical operational risk because an upgrade can change the protocol's rules.

If the two authorities diverge, that can be intentional, but it should be documented. For example, rotating only the Solana upgrade authority does not automatically rotate protocol authority.

## Checks

Run this before and after authority changes:

```bash
NEXT_PUBLIC_RPC_URL="$MAINNET_RPC" \
NEXT_PUBLIC_PROGRAM_ID=DLVHJQd8LUbypaoguREZ1sek4E7zeqPHYvw62KceFmQr \
npm --prefix app run check-admin:devnet
```

To fail CI or scripts when the program is still upgradeable and protocol authority differs from upgrade authority:

```bash
REQUIRE_AUTHORITY_MATCH=true \
NEXT_PUBLIC_RPC_URL="$MAINNET_RPC" \
NEXT_PUBLIC_PROGRAM_ID=DLVHJQd8LUbypaoguREZ1sek4E7zeqPHYvw62KceFmQr \
npm --prefix app run check-admin:devnet
```

Do not paste command output into public issues or docs unless `rpcUrl` has been redacted.

## Protocol Authority Rotation

Rotate protocol authority with:

```bash
NEXT_PUBLIC_RPC_URL="$MAINNET_RPC" \
NEXT_PUBLIC_PROGRAM_ID=DLVHJQd8LUbypaoguREZ1sek4E7zeqPHYvw62KceFmQr \
ANCHOR_WALLET=<current_protocol_authority_keypair> \
npm --prefix app run transfer-protocol-authority:devnet -- <new_authority_wallet>
```

The current protocol authority must sign via `ANCHOR_WALLET`. After rotation, run the admin check again and complete a smoke test.
