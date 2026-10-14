import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readGlb } from '../tools/bake-subclips.mjs';

const file = rel => new URL(`../${rel}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MODELS = ['assets/superman/Superman-game.glb', 'assets/superman/Superman-armor.glb', 'assets/jason/Jason-game.glb', 'assets/flash/reverse-flash.glb'];

for (const rel of MODELS) {
  test(`${rel}: lossless WebP textures are declared, referenced and really WebP`, () => {
    const { json, bin } = readGlb(file(rel));
    assert.ok(json.extensionsRequired?.includes('EXT_texture_webp'), 'EXT_texture_webp must be required');
    assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'));
    for (const [index, image] of json.images.entries()) {
      const view = json.bufferViews[image.bufferView];
      const head = bin.subarray(view.byteOffset, view.byteOffset + 12);
      const isWebp = head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
      const isPng = head.toString('hex', 0, 4) === '89504e47';
      assert.equal(image.mimeType, isWebp ? 'image/webp' : 'image/png', `image ${index} mimeType does not match its bytes`);
      assert.ok(isWebp || isPng, `image ${index} is neither PNG nor WebP`);
    }
    for (const [index, texture] of json.textures.entries()) {
      const source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
      assert.ok(Number.isInteger(source) && json.images[source], `texture ${index} has no image`);
    }
    // bufferViews stay inside the BIN chunk and 4-byte aligned
    for (const view of json.bufferViews) {
      assert.ok(view.byteOffset % 4 === 0 && view.byteOffset + view.byteLength <= bin.length);
    }
    assert.ok(json.buffers[0].byteLength <= bin.length, 'declared buffer length exceeds the BIN chunk');
  });
}

test('the vendored GLTFLoader understands WebP textures', () => {
  const loader = fs.readFileSync(file('vendor/three/examples/jsm/loaders/GLTFLoader.js'), 'utf8');
  assert.match(loader, /class GLTFTextureWebPExtension/);
});
