import { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import Tesseract from 'tesseract.js';
import axios from 'axios';

const API_URL = 'http://127.0.0.1:8787';

const parseKTP = (text) => {
  const lines = text.split('\n');
  let nik = '', nama = '', tempatLahir = '', tanggalLahir = '', alamat = '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].toUpperCase().replace(/[^A-Z0-9\s:\-\/\.]/g, '').trim();
    if (!raw) continue;

    // NIK Detection: looks for 16 consecutive digits
    // Only strip non-digit chars, do NOT replace letters with digits
    // as that causes misreads (e.g. 7 -> 2)
    if (!nik) {
        // First try: extract digits directly from original line (not uppercased)
        const origLine = lines[i];
        const digitsOnly = origLine.replace(/\D/g, '');
        if (digitsOnly.length >= 16) {
            const match = digitsOnly.match(/(\d{16})/);
            if(match) nik = match[1];
        }
    }

    // Nama
    if (raw.includes('NAMA') && !nama) {
       let val = raw.replace('NAMA', '').replace(/[:\.]/g, '').trim();
       // if current line is just "NAMA", check next line
       if(val.length < 3 && lines[i+1]) {
           val = lines[i+1].replace(/[^A-Z\s]/ig, '').trim();
       }
       nama = val;
    }

    // Tempat/Tgl Lahir
    if ((raw.includes('TEMPAT') || raw.includes('LAHIR')) && !tanggalLahir) {
       let val = raw.replace('TEMPAT/TGL LAHIR', '').replace('TEMPAT', '').replace('LAHIR', '').replace(/[:\.]/g, '').trim();
       // Try to find date pattern 00-00-0000
       const dateMatch = val.match(/\d{2}-\d{2}-\d{4}/);
       if (dateMatch) {
           tanggalLahir = dateMatch[0];
           // Assume everything before date is place
           tempatLahir = val.split(dateMatch[0])[0].replace(/,\s*$/, '').trim();
       }
    }
    
    // Alamat
    if (raw.includes('ALAMAT') && !alamat) {
        alamat = raw.replace('ALAMAT','').replace(/[:\.]/g,'').trim();
        // Append next line if it looks like part of address (RT/RW usually next)
        if(lines[i+1] && (lines[i+1].toUpperCase().includes('RT') || lines[i+1].toUpperCase().includes('RW'))) {
             alamat += ' ' + lines[i+1].trim();
        }
    }
  }

  return { nik, nama, tempatLahir, tanggalLahir, alamat };
};

function App() {
  const [step, setStep] = useState('capture');
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanIntervalId, setScanIntervalId] = useState(null);
  const [message, setMessage] = useState('');
  
  const [parsed, setParsed] = useState({
    nik: '',
    nama: '',
    tempatLahir: '',
    tanggalLahir: '',
    alamat: ''
  });
  const [purpose, setPurpose] = useState('');
  const webcamRef = useRef(null);
  const isProcessingRef = useRef(false);
  
  // Auto-start scanning when entering capture step
  useEffect(() => {
    if (step === 'capture') {
      startAutoScan();
    } else {
      stopAutoScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  
  // Clean up interval on unmount
  useEffect(() => {
    return () => {
        if (scanIntervalId) clearInterval(scanIntervalId);
    };
  }, [scanIntervalId]);

  const stopAutoScan = () => {
      if (scanIntervalId) {
          clearInterval(scanIntervalId);
          setScanIntervalId(null);
      }
      setIsScanning(false);
      setLoading(false);
  };

  // Pre-process image for better OCR results
  // Upscale 2x + Grayscale + gentle contrast (NOT aggressive binarization)
  const enhanceImage = (imageSrc) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = imageSrc;
      img.onload = () => {
        // Upscale 2x for much better OCR accuracy on small text
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Grayscale + Gentle contrast stretch (preserve digit shapes!)
        // Factor 1.5 contrast, centered at 128
        const contrast = 1.5;
        const intercept = 128 * (1 - contrast);
        
        for (let i = 0; i < data.length; i += 4) {
          // Weighted grayscale (luminance)
          const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          // Apply contrast
          let val = gray * contrast + intercept;
          val = Math.max(0, Math.min(255, val));
          
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
        }
        
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
    });
  };

  const startAutoScan = () => {
    if (isScanning) return;
    setIsScanning(true);
    setLoading(true); // Re-use loading state to show scanning indicator
    setMessage('Mencari KTP... Posisikan KTP agar jelas.');

    const id = setInterval(async () => {
      // Prevent overlapping processing to avoid lag
      if (isProcessingRef.current) return;
      if (!webcamRef.current) return;

      isProcessingRef.current = true;
      const imageSrc = webcamRef.current.getScreenshot();

      if (!imageSrc) {
        isProcessingRef.current = false;
        return;
      }
      
      try {
          // Pre-process image first
          const enhancedImg = await enhanceImage(imageSrc);

          const { data: { text } } = await Tesseract.recognize(enhancedImg, 'ind', {
            logger: () => {}
          });
          
          const result = parseKTP(text);
          
          // Heuristic: If we found a 16-digit NIK, it's 100% a KTP
          if (result.nik && result.nik.length === 16) {
              clearInterval(id);
              setScanIntervalId(null);
              setIsScanning(false);
              setLoading(false);
              
              setImage(imageSrc); // Save original color image
              setParsed(result);
              setStep('preview');
              setMessage('KTP Terdeteksi!');
              
              // Audio feedback instead of vibrate (no user gesture needed)
              try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = audioCtx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, audioCtx.currentTime);
                osc.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.15);
              } catch(e) {}
          } else {
             // Show partial progress if NIK looks close
             if (text.includes('NIK') || text.match(/\d{12,15}/)) {
                 setMessage('Mendeteksi... Tahan posisi!');
             } else {
                 setMessage('Mencari KTP...');
             }
          }
      } catch (err) {
          console.error(err);
      } finally {
         isProcessingRef.current = false;
      }
    }, 500); // Check frequently (500ms), but skip if previous frame is still processing
    setScanIntervalId(id);
  };
    
  const processImage = async (imgData) => {
    setLoading(true);
    setStep('preview');
    try {
      const enhancedImg = await enhanceImage(imgData);
      const {
        data: { text }
      } = await Tesseract.recognize(enhancedImg, 'ind', {
        logger: () => {}
      });
      const result = parseKTP(text);
      setParsed(result);
    } catch (error) {
      alert(`OCR gagal: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const capture = () => {
    if (!webcamRef.current) return;
    const img = webcamRef.current.getScreenshot();
    if (!img) return;
    setImage(img);
    processImage(img);
  };

  const handleUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (fileEvent) => {
      const dataUrl = fileEvent.target?.result;
      if (!dataUrl) return;
      setImage(dataUrl);
      processImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleEdit = (field, value) => {
    setParsed((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!parsed.nik || !parsed.nama || !purpose) {
      alert('NIK, Nama, dan Tujuan wajib diisi');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post(API_URL, { ...parsed, purpose });
      setMessage(response.data?.message || 'Kunjungan berhasil dicatat.');
      setStep('confirm');
    } catch (error) {
      const detail = error.response?.data?.error || error.message;
      alert(`Gagal menyimpan: ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep('capture');
    setImage(null);
    setParsed({
      nik: '',
      nama: '',
      tempatLahir: '',
      tanggalLahir: '',
      alamat: ''
    });
    setPurpose('');
    setMessage('');
  };

  return (
    <div className="container">
      <div className="card">
        <h1 className="title">Scan KTP Perpustakaan</h1>

        {step === 'capture' && (
          <>
            <div className="banner info">
              Data KTP Anda hanya diproses di perangkat ini untuk akurasi dan tidak
              disimpan oleh sistem kami.
            </div>
            <div className="section">
              <div>
                <p className="label">Posisikan KTP di dalam area kamera:</p>
                <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '8px' }}>
                  <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    className="preview"
                    videoConstraints={{
                      facingMode: 'environment'
                    }}
                  />
                  
                  {/* Grid Overlay */}
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    pointerEvents: 'none'
                  }}>
                    {/* Horizontal lines */}
                    <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.5)' }}></div>
                    <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.5)' }}></div>
                    {/* Vertical lines */}
                    <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.5)' }}></div>
                    <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.5)' }}></div>
                    
                    {/* Card outline guide */}
                    <div style={{
                        position: 'absolute',
                        top: '15%',
                        left: '10%',
                        right: '10%',
                        bottom: '15%',
                        border: '2px dashed rgba(255,255,255,0.8)',
                        borderRadius: '12px',
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)'
                    }}></div>
                  </div>

                  {isScanning && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      boxSizing: 'border-box',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 10
                    }}>
                      <div className="scan-line"></div>
                      <div style={{ 
                        position: 'absolute', 
                        bottom: '20px', 
                        background: 'rgba(0,0,0,0.7)', 
                        padding: '8px 16px', 
                        borderRadius: '20px',
                        color: 'white',
                        fontWeight: 'bold' 
                      }}>
                        {message || 'Mencari KTP...'}
                      </div>
                    </div>
                  )}
                </div>
                
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px', justifyContent: 'center' }}>
                   {/* Buttons removed as requested, auto-scan is active */}
                   <p className="footer-note">Sistem akan otomatis mendeteksi KTP saat posisinya pas.</p>
                </div>
              </div>
              <div className="separator">— atau —</div>
              <div>
                <label className="label" htmlFor="upload-ktp">
                  Unggah file KTP:
                </label>
                <input
                  id="upload-ktp"
                  type="file"
                  accept="image/*"
                  onChange={handleUpload}
                  className="input"
                />
              </div>
            </div>
          </>
        )}

        {step === 'preview' && (
          <div className="section">
            {image && <img src={image} alt="KTP" className="preview" />}
            {loading && <p className="footer-note">Memproses OCR...</p>}
            {!loading && (
              <>
                <div className="banner success">
                  <strong>Data terdeteksi.</strong> Silakan perbaiki jika perlu.
                </div>
                <div className="section">
                  <div>
                    <label className="label" htmlFor="nik">
                      NIK *
                    </label>
                    <input
                      id="nik"
                      type="text"
                      value={parsed.nik}
                      onChange={(event) => handleEdit('nik', event.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="nama">
                      Nama *
                    </label>
                    <input
                      id="nama"
                      type="text"
                      value={parsed.nama}
                      onChange={(event) => handleEdit('nama', event.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="tempat-lahir">
                      Tempat Lahir
                    </label>
                    <input
                      id="tempat-lahir"
                      type="text"
                      value={parsed.tempatLahir}
                      onChange={(event) =>
                        handleEdit('tempatLahir', event.target.value)
                      }
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="tanggal-lahir">
                      Tanggal Lahir
                    </label>
                    <input
                      id="tanggal-lahir"
                      type="date"
                      value={(() => {
                        // Convert DD-MM-YYYY to YYYY-MM-DD for date input
                        if (!parsed.tanggalLahir) return '';
                        const parts = parsed.tanggalLahir.match(/(\d{2})-(\d{2})-(\d{4})/);
                        if (parts) return `${parts[3]}-${parts[2]}-${parts[1]}`;
                        return parsed.tanggalLahir;
                      })()}
                      onChange={(event) => {
                        // Convert YYYY-MM-DD back to DD-MM-YYYY
                        const val = event.target.value;
                        if (val) {
                          const [y, m, d] = val.split('-');
                          handleEdit('tanggalLahir', `${d}-${m}-${y}`);
                        } else {
                          handleEdit('tanggalLahir', '');
                        }
                      }}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="alamat">
                      Alamat
                    </label>
                    <textarea
                      id="alamat"
                      value={parsed.alamat}
                      onChange={(event) => handleEdit('alamat', event.target.value)}
                      className="textarea"
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="purpose">
                      Tujuan Kunjungan *
                    </label>
                    <input
                      id="purpose"
                      type="text"
                      value={purpose}
                      onChange={(event) => setPurpose(event.target.value)}
                      className="input"
                      placeholder="Misal: Membaca, Meminjam buku"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  className="button success"
                >
                  {loading ? 'Menyimpan...' : 'Konfirmasi & Catat Kunjungan'}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="button secondary"
                >
                  Batalkan / Scan Ulang
                </button>
              </>
            )}
          </div>
        )}

        {step === 'confirm' && (
          <div className="section">
            <div className="banner success">✅ {message}</div>
            <p className="footer-note">
              Data Anda hanya digunakan untuk keperluan administrasi perpustakaan
              dan tidak akan disebarluaskan.
            </p>
            <button type="button" onClick={reset} className="button primary">
              Scan KTP Berikutnya
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
