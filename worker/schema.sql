CREATE TABLE visitors (
  nik TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  tempat_lahir TEXT,
  tanggal_lahir TEXT,
  alamat TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_nik TEXT NOT NULL,
  visit_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  purpose TEXT,
  FOREIGN KEY (visitor_nik) REFERENCES visitors(nik)
);
