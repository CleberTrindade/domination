-- Preserve fractions as pending production credit, without fractional wallets.
ALTER TABLE world_players DROP CONSTRAINT world_players_coin_income_remainder_check;
ALTER TABLE world_players ADD CONSTRAINT world_players_coin_income_remainder_check
  CHECK (coin_income_remainder>=0 AND coin_income_remainder<8640000000);
UPDATE world_players SET
  coin_income_remainder=coin_income_remainder+(coin_balance%100)*86400000,
  coin_balance=(coin_balance/100)*100
WHERE coin_balance%100<>0;
ALTER TABLE world_players ADD CONSTRAINT world_players_whole_coin_balance CHECK (coin_balance%100=0);
-- Historical ledger rows keep their original audit values. New rows must be whole.
ALTER TABLE world_coin_ledger ADD CONSTRAINT world_ledger_whole_new_coins CHECK (amount%100=0) NOT VALID;
