import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { v2 as cloudinary } from "cloudinary";
import mongoose, { mongo } from "mongoose";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import multer from "multer";
import streamifier from "streamifier";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();

app.use(cors({
  origin: 'https://frontend-skb.vercel.app', // Frontend URL
  credentials: true // Allow cookies
}));

app.use(express.json({ limit: "10mb" }));
const upload = multer({ storage: multer.memoryStorage() });
app.use(cookieParser());
// --- ENV dari Vercel ---
const SECRET_KEY = process.env.SECRET_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

// --- Cloudinary Config ---
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_SECRET,
});

// --- MongoDB Connection ---
await mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.error("❌ MongoDB Error:", err));



// --- Middleware: Verify Token ---
const verifyToken = (req, res, next) => {
   const token = req.cookies.token;
  try {
    const verif = jwt.verify(token, SECRET_KEY);
    if(verif){
      next();
    }else{
      res.json({ valid: false });
    }
  } catch (err) {
    res.json({ valid: false });
  }
};

// --- AUTH ROUTES ---
// Login
app.post("/login", async (req, res) => {
  const {username,  password } = req.body;
  // get mongodb 
  const userData = await mongoose.connection.db.collection('user').findOne({ username });
  if (!userData) {
    return res.status(401).json({ message: "User tidak ditemukan", success: false });
  }
  const passwordMatch = await bcrypt.compare(password, userData.password);
  if (!passwordMatch) {
    return res.status(401).json({ message: "Password salah", success: false });
  }
  const token = jwt.sign({ role: "admin" }, SECRET_KEY, { expiresIn: "24h" });
  // set cookies 
   res.cookie('token', token, {
    httpOnly: true,
    secure: false, // true jika HTTPS (kalau sudah pulish)
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  });
  return res.json({ message: "Login berhasil", success: true  });
});
// Logout
app.post("/logout", (req, res) => {
  res.clearCookie('token');
  res.json({ success : true, message: "Logout berhasil" });
});
// --- VERIFY TOKEN ROUTE ---
app.get("/verifyToken", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.json({ valid: false });
  }
  try {
    const verif = jwt.verify(token, SECRET_KEY);
    if(verif){
      res.json({ valid: true });
    }else{
      res.json({ valid: false });
    }
  } catch (err) {
    res.json({ valid: false });
  }
});

// --- IMAGE ROUTES ---

// Upload & Save to Database
app.post("/upload",verifyToken, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "Field 'image' wajib berisi file" });
    }


    // Upload ke Cloudinary dari buffer via upload_stream
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "magang", resource_type: "image", use_filename: true },
        (err, resUpload) => (err ? reject(err) : resolve(resUpload))
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });


    return res.json({
      success: true,
      message: "Gambar berhasil diupload",
      data: {
        imageUrl: result.secure_url,
        cloudinaryId: result.public_id
      }
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ success: false, error: "Gagal upload gambar" });
  }
});

// Get All Images (Public)
app.get("/images", async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const col =  mongoose.connection.db.collection('web data')
       const { images } = await col.findOne({}, { projection: { images: 1, _id: 0 } });
    
    res.json({ success: true, data: images });
  } catch (err) {
    console.error("Get images error:", err);
    res.status(500).json({ success: false, error: "Gagal mengambil data" });
  }
});
app.post("/images", verifyToken, async (req, res) => {
  try {
    const { imageAlt,  imageUrl, cloudinaryId } = req.body;
    const col =  mongoose.connection.db.collection('web data')
    const imageId = uuidv4();
    const updateResult = await col.updateOne(
      {},
      { $push: { images: {imageId: imageId,imageAlt: imageAlt, imageUrl: imageUrl, createdAt: new Date(), updatedAt: new Date(), cloudinaryId} } },
      { upsert: true }
    );
    if (updateResult.modifiedCount === 0 && updateResult.upsertedCount === 0) {
      return res.status(500).json({ success: false, error: "Gagal menyimpan gambar" });
    }
    const image = { imageAlt: imageAlt, imageUrl: imageUrl, cloudinaryId: cloudinaryId , imageId: imageId, createdAt: new Date(), updatedAt: new Date() };
    res.json({ success: true, message: "Gambar berhasil disimpan", data: image });
  } catch (err) {
    console.error("Save image error:", err);
    res.status(500).json({ success: false, error: "Gagal menyimpan gambar" });
  }
});

// Update Image (Admin only)
app.put("/images/:id", verifyToken, async (req, res) => {
  try {
  const mongoID = req.params.id;
  const { imageAlt, imageUrl, cloudinaryId } = req.body;
  const col =  mongoose.connection.db.collection('web data')
  const webData = await col.findOne({});
  if (!webData || !webData.images) {
    return res.status(404).json({ success: false, error: "Data gambar tidak ditemukan" });
  }

  const imageIndex = webData.images.findIndex(img => img.imageId === mongoID);
  if (imageIndex === -1) {
    return res.status(404).json({ success: false, error: "Gambar tidak ditemukan" });
  }
  // delete from cloudinary 
  if (webData.images[imageIndex].cloudinaryId) {
    await cloudinary.uploader.destroy(webData.images[imageIndex].cloudinaryId);
  }
  webData.images[imageIndex].imageAlt = imageAlt;
  webData.images[imageIndex].imageUrl = imageUrl;
  webData.images[imageIndex].cloudinaryId = cloudinaryId;
  webData.images[imageIndex].updatedAt = new Date();

  await col.updateOne({}, { $set: { images: webData.images } });
  res.json({ success: true, message: "Gambar berhasil diupdate", data: webData.images[imageIndex] });
  } catch (err) {
    res.status(500).json({ success: false, error: "Gagal update data" });
  }
});

// Delete Image (Admin only)
app.delete("/images/:id", verifyToken, async (req, res) => {
  try {
    const imageId = req.params.id;
    const col =  mongoose.connection.db.collection('web data')
    const webData = await col.findOne({});
    if (!webData || !webData.images) {
      return res.status(404).json({ success: false, error: "Data gambar tidak ditemukan" });
    }

    const imageIndex = webData.images.findIndex(img => img.imageId === imageId);
    const deletedImage = webData.images.splice(imageIndex, 1)[0];
    await col.updateOne({}, { $set: { images: webData.images } });
    // Hapus dari Cloudinary jika ada cloudinaryId
    if (deletedImage.cloudinaryId) {
      await cloudinary.uploader.destroy(deletedImage.cloudinaryId);
    }
    res.json({ success: true, message: "Gambar berhasil dihapus" });
  } catch (err) {
    console.error("Delete image error:", err);
    res.status(500).json({ success: false, error: "Gagal menghapus gambar" });  
  }
});

// --- TEST ROUTES ---
app.get("/", (_req, res) => {
  res.json({ message: "Backend SKB aktif 🚀"});
});

// update peserta paket route
app.post("/updatePesertaPaket", verifyToken, async (req, res) => {
  const { paudCount, paketACount, paketBCount, paketCCount } = req.body;
  try {
    const col = mongoose.connection.db.collection('web data');
    await col.updateOne({}, { $set: { pesertaPaket: {
      siswaPAUD: paudCount,
      paketA: paketACount,
      paketB: paketBCount,
      paketC: paketCCount
    } } }, { upsert: true });
    res.json({ success: true, message: "Statistik peserta paket berhasil diperbarui" });
  } catch (err) {
    console.error("Error updating peserta paket:", err);
    res.status(500).json({ success: false, error: "Gagal memperbarui statistik peserta paket" });
  }
});
app.get("/pesertaPaket", async (_req, res) => {
  try {
    const col = mongoose.connection.db.collection('web data');
    const {pesertaPaket} = await col.findOne({}, { projection: { pesertaPaket: 1, _id: 0 } });
    res.json({ success: true, data: pesertaPaket });
  } catch (err) {
    console.error("Error fetching peserta paket:", err);
    res.status(500).json({ success: false, error: "Gagal mengambil data peserta paket" });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Export untuk Vercel
export default app;
