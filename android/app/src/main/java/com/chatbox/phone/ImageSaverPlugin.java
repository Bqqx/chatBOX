package com.chatbox.phone;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

@CapacitorPlugin(name = "ImageSaver")
public class ImageSaverPlugin extends Plugin {
    @PluginMethod
    public void saveImage(PluginCall call) {
        String source = call.getString("source", "");
        String fileName = sanitizeFileName(call.getString("fileName", "image.png"));
        String mimeType = call.getString("mimeType", "image/png");

        if (source == null || source.trim().isEmpty()) {
            call.reject("Image source is empty");
            return;
        }

        getBridge().execute(() -> {
            try {
                byte[] bytes = readImageBytes(source);
                Uri uri = writeImage(bytes, fileName, mimeType);

                JSObject result = new JSObject();
                result.put("uri", uri.toString());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void copyImage(PluginCall call) {
        String source = call.getString("source", "");
        String fileName = sanitizeFileName(call.getString("fileName", "image.png"));
        String mimeType = call.getString("mimeType", "image/png");

        if (source == null || source.trim().isEmpty()) {
            call.reject("Image source is empty");
            return;
        }

        getBridge().execute(() -> {
            try {
                byte[] bytes = readImageBytes(source);
                Uri uri = writeImageToCache(bytes, fileName);
                ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);

                if (clipboard == null) {
                    throw new IllegalStateException("Unable to access clipboard");
                }

                ClipData clipData = ClipData.newUri(getContext().getContentResolver(), fileName, uri);
                clipboard.setPrimaryClip(clipData);
                getContext().grantUriPermission(getContext().getPackageName(), uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);

                JSObject result = new JSObject();
                result.put("uri", uri.toString());
                result.put("mimeType", mimeType);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage(), error);
            }
        });
    }

    private byte[] readImageBytes(String source) throws Exception {
        if (source.startsWith("data:image/")) {
            int commaIndex = source.indexOf(",");
            if (commaIndex < 0) {
                throw new IllegalArgumentException("Invalid data image");
            }
            return Base64.decode(source.substring(commaIndex + 1), Base64.DEFAULT);
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(60000);
        connection.setRequestProperty("User-Agent", "ChatBOX Android");

        try (InputStream input = connection.getInputStream()) {
            return readAllBytes(input);
        } finally {
            connection.disconnect();
        }
    }

    private byte[] readAllBytes(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private Uri writeImage(byte[] bytes, String fileName, String mimeType) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ChatBOX");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
        }

        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new IllegalStateException("Unable to create image in gallery");
        }

        try (OutputStream output = resolver.openOutputStream(uri)) {
            if (output == null) {
                throw new IllegalStateException("Unable to open image output stream");
            }
            output.write(bytes);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
        }

        return uri;
    }

    private Uri writeImageToCache(byte[] bytes, String fileName) throws Exception {
        File cacheDir = new File(getContext().getCacheDir(), "copied-images");
        if (!cacheDir.exists() && !cacheDir.mkdirs()) {
            throw new IllegalStateException("Unable to create clipboard image cache");
        }

        File imageFile = new File(cacheDir, fileName);
        try (OutputStream output = new FileOutputStream(imageFile)) {
            output.write(bytes);
        }

        return FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            imageFile
        );
    }

    private String sanitizeFileName(String fileName) {
        String clean = fileName.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (clean.isEmpty()) {
            return "image.png";
        }
        return clean.toLowerCase(Locale.ROOT).matches(".*\\.(png|jpg|jpeg|webp|gif)$")
            ? clean
            : clean + ".png";
    }
}
