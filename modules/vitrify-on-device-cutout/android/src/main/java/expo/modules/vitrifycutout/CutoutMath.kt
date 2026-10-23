package expo.modules.vitrifycutout

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.util.zip.CRC32
import java.util.zip.DeflaterOutputStream
import kotlin.math.*

/** CPU-only rembg/u2netp math. No Android/JS objects or user identifiers. */
internal object CutoutMath {
  fun normalize(rgb: ByteArray): FloatArray {
    require(rgb.isNotEmpty() && rgb.size % 3 == 0)
    val pixels = rgb.size / 3
    val maximum = max(rgb.maxOf { it.toInt() and 255 }.toDouble(), 1e-6)
    val mean = doubleArrayOf(0.485, 0.456, 0.406)
    val std = doubleArrayOf(0.229, 0.224, 0.225)
    return FloatArray(rgb.size) { index ->
      val channel = index / pixels
      (((rgb[(index % pixels) * 3 + channel].toInt() and 255) / maximum - mean[channel]) / std[channel]).toFloat()
    }
  }

  fun mask(prediction: FloatArray): ByteArray {
    require(prediction.isNotEmpty() && prediction.all { it.isFinite() })
    val low = prediction.minOrNull()!!
    val range = prediction.maxOrNull()!! - low
    require(range > 0 && range.isFinite()) { "CUTOUT_MASK_INVALID" }
    return ByteArray(prediction.size) { (((prediction[it] - low) / range) * 255f).toInt().coerceIn(0, 255).toByte() }
  }

  private data class Weights(val start: Int, val values: DoubleArray)
  private fun weights(input: Int, output: Int): Array<Weights> {
    val scale = input.toDouble() / output
    val filterScale = max(1.0, scale)
    val radius = 3.0 * filterScale
    fun lanczos(x: Double): Double {
      val a = abs(x)
      if (a == 0.0) return 1.0
      if (a >= 3.0) return 0.0
      return sin(PI * x) * sin(PI * x / 3.0) / (PI * PI * x * x / 3.0)
    }
    return Array(output) { destination ->
      val center = (destination + 0.5) * scale
      val start = max(0, floor(center - radius + 0.5).toInt())
      val end = min(input, floor(center + radius + 0.5).toInt())
      val coefficients = DoubleArray(end - start) { lanczos((start + it + 0.5 - center) / filterScale) }
      val total = coefficients.sum()
      if (total != 0.0) coefficients.indices.forEach { coefficients[it] /= total }
      Weights(start, coefficients)
    }
  }

  /** Pillow-style separable Lanczos3 with downsample antialiasing, byte rounding per pass. */
  fun resize(data: ByteArray, width: Int, height: Int, channels: Int, outWidth: Int, outHeight: Int): ByteArray {
    require(width > 0 && height > 0 && outWidth > 0 && outHeight > 0 && channels in 1..3)
    require(data.size == width * height * channels)
    if (width == outWidth && height == outHeight) return data
    val horizontal = if (width == outWidth) data else {
      val coefficients = weights(width, outWidth)
      ByteArray(outWidth * height * channels).also { target ->
        for (y in 0 until height) for (x in 0 until outWidth) for (channel in 0 until channels) {
          val kernel = coefficients[x]
          var sum = 0.0
          kernel.values.indices.forEach { index ->
            sum += (data[(y * width + kernel.start + index) * channels + channel].toInt() and 255) * kernel.values[index]
          }
          target[(y * outWidth + x) * channels + channel] = floor(sum + 0.5).toInt().coerceIn(0, 255).toByte()
        }
      }
    }
    if (height == outHeight) return horizontal
    val coefficients = weights(height, outHeight)
    return ByteArray(outWidth * outHeight * channels).also { target ->
      for (y in 0 until outHeight) for (x in 0 until outWidth) for (channel in 0 until channels) {
        val kernel = coefficients[y]
        var sum = 0.0
        kernel.values.indices.forEach { index ->
          sum += (horizontal[((kernel.start + index) * outWidth + x) * channels + channel].toInt() and 255) * kernel.values[index]
        }
        target[(y * outWidth + x) * channels + channel] = floor(sum + 0.5).toInt().coerceIn(0, 255).toByte()
      }
    }
  }

  /** PNG color type 6; no EXIF/GPS chunks or premultiplied Bitmap conversion. */
  fun png(rgb: ByteArray, alpha: ByteArray, width: Int, height: Int): ByteArray {
    require(width in 1..1600 && height in 1..1600 && rgb.size == width * height * 3 && alpha.size == width * height)
    val compressed = ByteArrayOutputStream()
    DeflaterOutputStream(compressed).use { stream ->
      val row = ByteArray(width * 4 + 1) // filter 0
      for (y in 0 until height) {
        for (x in 0 until width) {
          val pixel = y * width + x
          val a = alpha[pixel].toInt() and 255
          for (channel in 0..2) {
            val color = rgb[pixel * 3 + channel].toInt() and 255
            row[x * 4 + channel + 1] = ((color * a + 127) / 255).toByte()
          }
          row[x * 4 + 4] = a.toByte()
        }
        stream.write(row)
      }
    }
    val output = ByteArrayOutputStream()
    val writer = DataOutputStream(output)
    writer.write(byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10))
    fun chunk(type: String, data: ByteArray) {
      val name = type.toByteArray(Charsets.US_ASCII)
      writer.writeInt(data.size); writer.write(name); writer.write(data)
      val crc = CRC32(); crc.update(name); crc.update(data); writer.writeInt(crc.value.toInt())
    }
    val header = ByteArrayOutputStream()
    DataOutputStream(header).use { it.writeInt(width); it.writeInt(height); it.write(byteArrayOf(8, 6, 0, 0, 0)) }
    chunk("IHDR", header.toByteArray()); chunk("IDAT", compressed.toByteArray()); chunk("IEND", byteArrayOf())
    return output.toByteArray().also { require(it.size <= 12 * 1024 * 1024) }
  }
}
