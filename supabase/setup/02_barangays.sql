-- UniGuard: the 32 barangays of Lingayen. Run after 01_schema.sql. Safe to re-run.
insert into public.barangays (name, city) values
  ('Aliwekwek',         'Lingayen'), ('Baay',              'Lingayen'),
  ('Balangobong',       'Lingayen'), ('Balococ',           'Lingayen'),
  ('Bantayan',          'Lingayen'), ('Basing',            'Lingayen'),
  ('Capandanan',        'Lingayen'), ('Domalandan Center', 'Lingayen'),
  ('Domalandan East',   'Lingayen'), ('Domalandan West',   'Lingayen'),
  ('Dorongan',          'Lingayen'), ('Dulag',             'Lingayen'),
  ('Estanza',           'Lingayen'), ('Lasip',             'Lingayen'),
  ('Libsong East',      'Lingayen'), ('Libsong West',      'Lingayen'),
  ('Malawa',            'Lingayen'), ('Malimpuec',         'Lingayen'),
  ('Maniboc',           'Lingayen'), ('Matalava',          'Lingayen'),
  ('Naguelguel',        'Lingayen'), ('Namolan',           'Lingayen'),
  ('Pangapisan North',  'Lingayen'), ('Pangapisan Sur',    'Lingayen'),
  ('Poblacion',         'Lingayen'), ('Quibaol',           'Lingayen'),
  ('Rosario',           'Lingayen'), ('Sabangan',          'Lingayen'),
  ('Talogtog',          'Lingayen'), ('Tonton',            'Lingayen'),
  ('Tumbar',            'Lingayen'), ('Wawa',              'Lingayen')
on conflict (name) do nothing;
