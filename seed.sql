-- Coordinates are placeholders around your pinned point (lng,lat). Replace with exact block locations.
INSERT INTO blocks VALUES
('IB','IB Block',ST_MakePoint(77.2752,11.5004)::geography),
('AS','AS Block',ST_MakePoint(77.2754,11.5005)::geography),
('MECH','Mechanical Block',ST_MakePoint(77.2751,11.5002)::geography),
('SF','SF Block',ST_MakePoint(77.275166,11.500317)::geography) ON CONFLICT DO NOTHING;
INSERT INTO facilities(block,name,type) SELECT b.code,b.code||' '||n,'classroom' FROM blocks b,generate_series(101,106) n ON CONFLICT DO NOTHING;
INSERT INTO facilities(block,name,type) VALUES
('SF','Seminar Hall 1','seminar'),('SF','Seminar Hall 2','seminar'),('SF','Seminar Hall 3','seminar'),
('IB','EEE Seminar Hall','seminar'),('IB','EIE Seminar Hall','seminar'),('IB','Biotech Seminar Hall','seminar'),
('AS','Textile Seminar Hall','seminar'),('AS','ECE Seminar Hall','seminar'),('AS','Biomedical Seminar Hall','seminar');
INSERT INTO facilities(block,name,type) VALUES
(NULL,'Computer Lab','lab'),(NULL,'Physics Lab','lab'),(NULL,'Chemistry Lab','lab'),(NULL,'Mechanical Workshop','lab'),(NULL,'Electronics Lab','lab'),
(NULL,'Cricket Ground','sports'),(NULL,'Basketball Court','sports'),(NULL,'Volleyball Court','sports'),(NULL,'Indoor Stadium','sports');
