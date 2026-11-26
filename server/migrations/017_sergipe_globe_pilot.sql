-- Additive pilot expansion. Existing area IDs, owners, versions and history stay intact.
INSERT INTO world_areas(id,state_id,name,ordinal,description,cpu_share) VALUES
 ('se-area-06','SE','Área 06',6,'Explore ilhas e rotas alternativas de Sergipe.',.35),
 ('se-area-07','SE','Área 07',7,'Dispute uma nova frente no território sergipano.',.35),
 ('se-area-08','SE','Área 08',8,'Controle as passagens e distribua seus reforços.',.35),
 ('se-area-09','SE','Área 09',9,'Avance por caminhos em mais de uma direção.',.35),
 ('se-area-10','SE','Área 10',10,'Conquiste as posições desta nova área de Sergipe.',.35)
ON CONFLICT (id) DO NOTHING;
