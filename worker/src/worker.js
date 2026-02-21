const jsonResponse = (body, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');

  return new Response(JSON.stringify(body), {
    ...init,
    headers
  });
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return jsonResponse(null, { status: 204 });
    }

    if (request.method === 'GET') {
      return jsonResponse({ message: 'Worker is running. Please use POST to submit data.' }, { status: 200 });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const { nik, nama, tempatLahir, tanggalLahir, alamat, purpose } =
        await request.json();

      if (!nik || !nama || !purpose) {
        return jsonResponse(
          { error: 'NIK, Nama, dan Tujuan wajib diisi' },
          { status: 400 }
        );
      }

      const existing = await env.DB.prepare(
        'SELECT nik FROM visitors WHERE nik = ?'
      )
        .bind(nik)
        .first();

      if (!existing) {
        await env.DB.prepare(
          'INSERT INTO visitors (nik, nama, tempat_lahir, tanggal_lahir, alamat) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(nik, nama, tempatLahir || null, tanggalLahir || null, alamat || null)
          .run();
      }

      await env.DB.prepare(
        'INSERT INTO visits (visitor_nik, purpose) VALUES (?, ?)'
      )
        .bind(nik, purpose)
        .run();

      return jsonResponse({
        success: true,
        message: `Selamat datang, ${nama}! Kunjungan Anda berhasil dicatat.`
      });
    } catch (error) {
      return jsonResponse({ error: error.message }, { status: 500 });
    }
  }
};
