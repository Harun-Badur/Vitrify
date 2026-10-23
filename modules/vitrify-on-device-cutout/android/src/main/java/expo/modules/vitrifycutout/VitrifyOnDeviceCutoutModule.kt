package expo.modules.vitrifycutout

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Debug
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class VitrifyOnDeviceCutoutModule : Module() {
  private val worker = Executors.newSingleThreadExecutor { action -> Thread(action, "VitrifyCutoutCPU") }
  // Reserved until JS has checkpointed the file and awaited release().
  private val busy = AtomicBoolean(false)
  private var artifact: ByteArray? = null
  private var artifactHandle: String? = null
  private class CutoutFailure(val safeCode: String) : Exception()

  override fun definition() = ModuleDefinition {
    Name("VitrifyOnDeviceCutout")
    Function("isAvailable") {
      ((appContext.reactContext?.applicationInfo?.flags ?: 0) and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }
    AsyncFunction("process") { source: String, measure: Boolean, promise: Promise ->
      if (!busy.compareAndSet(false, true)) {
        promise.reject("CUTOUT_NATIVE_BUSY", "Cihaz işlemi devam ediyor.", null)
      } else {
        worker.execute {
          try {
            val context = appContext.reactContext ?: throw CutoutFailure("CUTOUT_NATIVE_UNAVAILABLE")
            if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0)
              throw CutoutFailure("CUTOUT_NATIVE_UNAVAILABLE")
            val (png, timings) = processImage(context, source, measure)
            val handle = UUID.randomUUID().toString()
            artifact = png; artifactHandle = handle
            promise.resolve(timings + mapOf("handle" to handle))
          } catch (error: Throwable) {
            wipe()
            // Never send exception messages, paths, tensor values or causes to JS/logs.
            promise.reject((error as? CutoutFailure)?.safeCode ?: "CUTOUT_NATIVE_FAILED", "Cihaz işlemi doğrulanamadı.", null)
          }
        }
      }
    }
    AsyncFunction("write") { handle: String, destination: String, promise: Promise ->
      worker.execute {
        try {
          val bytes = artifact ?: throw CutoutFailure("CUTOUT_NATIVE_ARTIFACT_MISSING")
          if (handle != artifactHandle) throw CutoutFailure("CUTOUT_NATIVE_ARTIFACT_MISMATCH")
          if (appContext.reactContext == null) throw CutoutFailure("CUTOUT_NATIVE_UNAVAILABLE")
          val file = ownedFile(destination)
          if (file.exists() || !file.parentFile!!.isDirectory) throw CutoutFailure("CUTOUT_NATIVE_WRITE_FAILED")
          // JS has already persisted/read back the owner ledger CREATING intent.
          // A crash leaves this exact path covered by the existing deletion inventory.
          FileOutputStream(file).use { it.write(bytes); it.fd.sync() }
          if (file.length() != bytes.size.toLong()) throw CutoutFailure("CUTOUT_NATIVE_WRITE_FAILED")
          promise.resolve(mapOf("bytes" to bytes.size))
        } catch (_: Throwable) {
          promise.reject("CUTOUT_NATIVE_WRITE_FAILED", "Fotoğraf cihazda doğrulanamadı.", null)
        }
      }
    }
    AsyncFunction("release") { handle: String, promise: Promise ->
      worker.execute {
        if (artifactHandle != null && handle != artifactHandle) {
          promise.reject("CUTOUT_NATIVE_ARTIFACT_MISMATCH", "İşlem kimliği doğrulanamadı.", null)
        } else {
          wipe(); promise.resolve()
        }
      }
    }
    OnDestroy {
      // Do not interrupt inference and pretend it drained. This runs after queued work.
      worker.execute { wipe() }
      worker.shutdown()
    }
  }

  private fun wipe() {
    artifact?.fill(0); artifact = null; artifactHandle = null; busy.set(false)
  }

  private fun ownedFile(uri: String): File {
    val parsed = Uri.parse(uri)
    if (parsed.scheme != "file" || parsed.query != null || parsed.fragment != null || !parsed.authority.isNullOrEmpty())
      throw CutoutFailure("CUTOUT_NATIVE_PATH_INVALID")
    val file = File(parsed.path ?: throw CutoutFailure("CUTOUT_NATIVE_PATH_INVALID")).canonicalFile
    val root = File(appContext.persistentFilesDirectory, "wardrobe").canonicalPath + File.separator
    if (!file.path.startsWith(root)) throw CutoutFailure("CUTOUT_NATIVE_PATH_INVALID")
    return file
  }

  private fun oriented(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      2 -> matrix.setScale(-1f, 1f)
      3 -> matrix.setRotate(180f)
      4 -> { matrix.setRotate(180f); matrix.postScale(-1f, 1f) }
      5 -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
      6 -> matrix.setRotate(90f)
      7 -> { matrix.setRotate(270f); matrix.postScale(-1f, 1f) }
      8 -> matrix.setRotate(270f)
      else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, false)
  }

  private fun rgb(bitmap: Bitmap): ByteArray {
    val result = ByteArray(bitmap.width * bitmap.height * 3)
    val row = IntArray(bitmap.width)
    for (y in 0 until bitmap.height) {
      bitmap.getPixels(row, 0, bitmap.width, 0, y, bitmap.width, 1)
      for (x in row.indices) {
        val offset = (y * bitmap.width + x) * 3
        result[offset] = (row[x] shr 16).toByte()
        result[offset + 1] = (row[x] shr 8).toByte()
        result[offset + 2] = row[x].toByte()
      }
    }
    return result
  }

  private fun processImage(context: Context, source: String, measure: Boolean): Pair<ByteArray, Map<String, Double>> {
    val start = System.nanoTime()
    fun elapsed(from: Long) = (System.nanoTime() - from) / 1_000_000.0
    var sampledPss = 0L
    fun sampleMemory() { if (measure) sampledPss = max(sampledPss, Debug.getPss()) }
    sampleMemory()
    val input = ownedFile(source)
    if (!input.isFile || input.length() !in 1..(12L * 1024 * 1024)) throw CutoutFailure("CUTOUT_NATIVE_INPUT_INVALID")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(input.path, bounds)
    val pixels = bounds.outWidth.toLong() * bounds.outHeight
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || pixels > 40_000_000) throw CutoutFailure("CUTOUT_NATIVE_INPUT_INVALID")
    val runtime = Runtime.getRuntime()
    val available = runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory())
    // No quality-reducing decode fallback: preserve original and fail safely instead.
    if (pixels * 8 + 64L * 1024 * 1024 > available * 0.8) throw CutoutFailure("CUTOUT_NATIVE_MEMORY_LIMIT")
    val bitmap = BitmapFactory.decodeFile(input.path, BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888; inScaled = false
    }) ?: throw CutoutFailure("CUTOUT_NATIVE_DECODE_FAILED")
    var transformed: Bitmap? = null
    val (width, height, sourceRgb) = try {
      val orientation = ExifInterface(input.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1)
      val image = oriented(bitmap, orientation)
      transformed = image
      Triple(image.width, image.height, rgb(image))
    } finally {
      if (transformed !== bitmap) transformed?.recycle()
      bitmap.recycle()
    }
    val scale = min(1.0, 1600.0 / max(width, height))
    val outWidth = max(1, (width * scale).roundToInt())
    val outHeight = max(1, (height * scale).roundToInt())
    val imageRgb = CutoutMath.resize(sourceRgb, width, height, 3, outWidth, outHeight)
    val tensorData = CutoutMath.normalize(CutoutMath.resize(imageRgb, outWidth, outHeight, 3, 320, 320))
    val preprocessingMs = elapsed(start)
    sampleMemory()
    val loadStart = System.nanoTime()
    val model = context.assets.open("u2netp.onnx").use { it.readBytes() }
    val digest = MessageDigest.getInstance("SHA-256").digest(model).joinToString("") { "%02x".format(it.toInt() and 255) }
    if (digest != MODEL_SHA256) throw CutoutFailure("CUTOUT_NATIVE_MODEL_INVALID")
    val environment = OrtEnvironment.getEnvironment()
    val options = OrtSession.SessionOptions()
    try {
      options.setIntraOpNumThreads(2); options.setInterOpNumThreads(1)
      environment.createSession(model, options).use { session ->
        val modelLoadMs = elapsed(loadStart)
        val inferenceStart = System.nanoTime()
        OnnxTensor.createTensor(environment, FloatBuffer.wrap(tensorData), longArrayOf(1, 3, 320, 320)).use { tensor ->
          session.run(mapOf(session.inputNames.first() to tensor), setOf(session.outputNames.first())).use { result ->
            @Suppress("UNCHECKED_CAST")
            val values = result[0].value as Array<Array<Array<FloatArray>>>
            if (values.size != 1 || values[0].size != 1 || values[0][0].size != 320 || values[0][0].any { it.size != 320 })
              throw CutoutFailure("CUTOUT_NATIVE_OUTPUT_INVALID")
            val prediction = FloatArray(320 * 320) { values[0][0][it / 320][it % 320] }
            val inferenceMs = elapsed(inferenceStart)
            sampleMemory()
            val encodeStart = System.nanoTime()
            val mask = try { CutoutMath.mask(prediction) } catch (_: IllegalArgumentException) { throw CutoutFailure("CUTOUT_NATIVE_MASK_INVALID") }
            val alpha = CutoutMath.resize(mask, 320, 320, 1, outWidth, outHeight)
            if (alpha.all { it == 0.toByte() } || alpha.all { it == 255.toByte() }) throw CutoutFailure("CUTOUT_NATIVE_MASK_INVALID")
            val png = CutoutMath.png(imageRgb, alpha, outWidth, outHeight)
            val encodeMs = elapsed(encodeStart)
            sampleMemory()
            return png to if (measure) mapOf("preprocessingMs" to preprocessingMs, "modelLoadMs" to modelLoadMs,
              "inferenceMs" to inferenceMs, "pngEncodeMs" to encodeMs, "totalMs" to elapsed(start), "sampledPssMaxKb" to sampledPss.toDouble()) else emptyMap()
          }
        }
      }
    } finally {
      model.fill(0); tensorData.fill(0f); options.close()
      // Sessions/results/tensors close via use(); the shared ORT environment is not closed.
    }
  }

  companion object {
    private const val MODEL_SHA256 = "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8"
  }
}
