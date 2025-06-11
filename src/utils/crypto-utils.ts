// import * as Crypto from 'expo-crypto';
// import { Buffer } from "@craftzdog/react-native-buffer";

// const ALGO = "aes-256-gcm";
// const IV_LEN = 12;
// const TAG_LEN = 16;

// export function generateKey() {
//     return Crypto.getRandomBytes(32);
// }

// function arrayBufferToBase64(buffer: Buffer) {
//     const bytes = new Uint8Array(buffer);
//     let binary = '';
//     bytes.forEach((byte) => binary += String.fromCharCode(byte));
//     return btoa(binary);
// }

// // Helper function to convert base64 to ArrayBuffer
// export function base64ToArrayBuffer(base64: string) {
//     const binaryString = atob(base64);
//     const bytes = new Uint8Array(binaryString.length);
//     for (let i = 0; i < binaryString.length; i++) {
//         bytes[i] = binaryString.charCodeAt(i);
//     }
//     return bytes.buffer;
// }

// export function encryptWithAes(key: Buffer, plaintext: string): string {
//     const iv = Crypto.getRandomBytes(IV_LEN);
//     const cipher = Crypto.createCipheriv(ALGO, key, iv);
//     const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
//     const tag = cipher.getAuthTag();
//     return arrayBufferToBase64(Buffer.concat([iv, tag, encrypted]));
//     // return Buffer.concat([iv, tag, encrypted]).toString("base64");
// }

// export function decryptWithAes(key: Buffer, encryptedBase64: string): string {
//     const buffer = Buffer.from(base64ToArrayBuffer(encryptedBase64));
//     // const buffer = Buffer.from(encryptedBase64, "base64");
//     const iv = buffer.slice(0, IV_LEN);
//     const tag = buffer.slice(IV_LEN, IV_LEN + TAG_LEN);
//     const encrypted = buffer.slice(IV_LEN + TAG_LEN);

//     const decipher = Crypto.createDecipheriv(ALGO, key, iv);
//     decipher.setAuthTag(tag);
//     return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
// }