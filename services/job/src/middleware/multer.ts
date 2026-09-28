import multer from "multer";

const storage = multer.memoryStorage();

const uploadFile = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single("file");

export default uploadFile;
