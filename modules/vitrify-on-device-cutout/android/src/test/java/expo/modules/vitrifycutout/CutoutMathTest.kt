package expo.modules.vitrifycutout

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.util.zip.InflaterInputStream

class CutoutMathTest {
  @Test fun normalizationUsesImageMaximumAndNchw() {
    val input = byteArrayOf(128.toByte(), 64, 0, 32, 16, 8)
    val tensor = CutoutMath.normalize(input)
    assertEquals(((1.0 - 0.485) / 0.229).toFloat(), tensor[0], 0.000001f)
    assertEquals(((0.25 - 0.485) / 0.229).toFloat(), tensor[1], 0.000001f)
    assertEquals(((0.5 - 0.456) / 0.224).toFloat(), tensor[2], 0.000001f)
    assertEquals(((0.0 - 0.406) / 0.225).toFloat(), tensor[4], 0.000001f)
    assertTrue(CutoutMath.normalize(ByteArray(6)).all { it.isFinite() })
  }

  @Test fun maskMinMaxAndConstantFailure() {
    assertArrayEquals(byteArrayOf(0, 127, 255.toByte()), CutoutMath.mask(floatArrayOf(2f, 3f, 4f)))
    try { CutoutMath.mask(floatArrayOf(1f, 1f)); fail("Constant mask accepted") }
    catch (_: IllegalArgumentException) { }
  }

  @Test fun lanczosPreservesIdentityAndConstantRgb() {
    val rgb = byteArrayOf(10, 20, 30, 10, 20, 30)
    assertArrayEquals(rgb, CutoutMath.resize(rgb, 2, 1, 3, 2, 1))
    assertArrayEquals(ByteArray(12) { byteArrayOf(10, 20, 30)[it % 3] }, CutoutMath.resize(rgb, 2, 1, 3, 2, 2))
  }

  @Test fun pngIsRgbaAndMatchesRembgNaiveCompositeWithoutMetadata() {
    val png = CutoutMath.png(byteArrayOf(200.toByte(), 100, 50), byteArrayOf(128.toByte()), 1, 1)
    assertArrayEquals(byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10), png.copyOfRange(0, 8))
    assertEquals(6, png[25].toInt())
    val chunks = mutableListOf<String>()
    var offset = 8
    while (offset < png.size) {
      val size = ByteBuffer.wrap(png, offset, 4).int
      val type = String(png, offset + 4, 4, Charsets.US_ASCII)
      chunks.add(type)
      if (type == "IDAT") {
        val raw = InflaterInputStream(png.copyOfRange(offset + 8, offset + 8 + size).inputStream()).readBytes()
        assertArrayEquals(byteArrayOf(0, 100, 50, 25, 128.toByte()), raw)
      }
      offset += size + 12
    }
    assertEquals(listOf("IHDR", "IDAT", "IEND"), chunks)
  }
}
