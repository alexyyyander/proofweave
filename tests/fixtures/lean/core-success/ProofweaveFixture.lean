namespace ProofweaveFixture

theorem true_is_inhabited : True := True.intro

theorem natural_addition_commutes (left right : Nat) : left + right = right + left :=
  Nat.add_comm left right

end ProofweaveFixture
