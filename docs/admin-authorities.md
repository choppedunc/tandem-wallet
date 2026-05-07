# Admin Authorities

Tandem Wallet has two separate admin controls:

- Protocol authority: stored in the protocol config PDA. This wallet can update protocol fee bps, update the treasury USDC ATA, and transfer protocol authority.
- Program upgrade authority: stored in Solana's upgradeable loader ProgramData account. This wallet can deploy new program code while the program remains upgradeable.

## Risk Model

If protocol authority is compromised, the attacker cannot directly drain vault balances or approve proposals. They can change future fee settings and treasury routing, so vault activity after compromise can be economically redirected.

If program upgrade authority is compromised, the attacker can deploy malicious program code. This is a critical operational risk because an upgrade can change the protocol's rules.

If the two authorities diverge, that can be intentional, but it should be documented. For example, rotating only the Solana upgrade authority does not automatically rotate protocol authority.

## Checks

Run this before and after authority changes:

```bash
npm run check-admin:devnet
```

To fail CI or scripts when the program is still upgradeable and protocol authority differs from upgrade authority:

```bash
REQUIRE_AUTHORITY_MATCH=true npm run check-admin:devnet
```

## Protocol Authority Rotation

Rotate protocol authority with:

```bash
npm run transfer-protocol-authority:devnet -- <new_authority_wallet>
```

The current protocol authority must sign via `ANCHOR_WALLET`. After rotation, run `npm run check-admin:devnet` and a smoke test.
