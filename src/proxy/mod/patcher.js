const { join } = require("path")
const { readdir, stat, exists, readFile } = require("fs-extra")
const Jimp = require("./jimp")
const crypto = require("crypto")

const Logger = require("./../ipc")
const { getConfig } = require("./../config")
const { cacheModded, checkCached } = require("./patchedcache")

/**
 * @typedef {Object} Patched
 * @property {string} path
 * @property {number} [w]
 * @property {number} [h]
 */
/**
 * @typedef {Object} Patch
 * @property {Object.<string, Patched>} original
 * @property {Object.<string, Patched>} patched
 * */

/** @type {Object.<string, Patch>} */
let modCache = undefined
async function reloadModCache() {
    if (!getConfig().enableModder) return
    const startTime = Date.now()
    modCache = {}

    for (const mod of getConfig().mods) {
        const modDir = mod.replace(/\.mod\.json$/, "")

        const meta = JSON.parse(await readFile(mod))

        Logger.log("Preparing", modDir)
        await prepareDir(modDir, meta)
    }

    Logger.log("Preparing mod images took", Date.now() - startTime, "ms")
}

async function prepareDir(dir, modMeta, path = []) {
    await Promise.all((await readdir(dir)).map(async f => {
        const filePath = join(dir, f)
        const stats = await stat(filePath)

        if (stats.isDirectory())
            await prepareDir(filePath, modMeta, [...path, f])
        else if (stats.isFile()) {
            let type = path[path.length-1]
            let target, targetName = f + (modMeta.name||"") + (modMeta.version||"")

            if (type !== "original" && type !== "patched") {
                if (f.startsWith("original")) type = "original"
                else if (f.startsWith("patched")) type = "patched"
                else {
                    Logger.error(`Invalid path ${filePath}`)
                    return
                }

                targetName = targetName.replace(/^(original|patched)/, "")
                target = "/" + path.join("/")
            } else
                target = "/" + path.slice(0, path.length-1).join("/")

            if (!modCache[target])
                modCache[target] = {}
            if (!modCache[target][type])
                modCache[target][type] = {}

            modCache[target][type][targetName] = { path: filePath }
        }
    }))
}

/**
 * If necesarry, will patch the file
 *
 * @param {string} file File path
 * @param {string|Buffer} contents Contents of file
 * @param {string} cacheFile Cache file locatio
 * @param {any} cachedFile Cache metadata
 */
async function patch(file, contents, cacheFile, cachedFile) {
    if (modCache === undefined)
        await reloadModCache()

    return await getModified(file, contents, cacheFile, cachedFile)
}


/**
 * @typedef PatchObject
 * @property {string | Buffer} original
 * @property {string | Buffer} patched
 * @property {string} name
 */

/**
 * Patch an asset, returns patched asset
 *
 * @param {string} file File path
 * @param {string|Buffer} contents Contents of file
 * @param {string} cacheFile Cache file location
 * @param {any} cachedFile Cache metadata
 */
async function getModified(file, contents, cacheFile, cachedFile) {
    const startTime = Date.now()

    // Get relevant patches
    /** @type {PatchObject[]} */
    const patches = []
    const patchHashes = crypto.createHash("md5")
    const paths = file.split("/")
    while (paths.length > 1) {
        const patch = modCache[paths.join("/")]
        if (patch) {
            for (const [name, { path }] of Object.entries(patch.original).sort(([a], [b]) => a.localeCompare(b)))  {
                if (!patch.patched[name]) {
                    Logger.error(`Missing ${name} in patched - delete original file if no patch needed!`)
                    continue
                }
                const content = await readFile(patch.patched[name].path)
                patchHashes.update(content)
                patches.push({original: path, patched: content, name})
            }
        }
        paths.pop()
    }

    const patchHash = patchHashes.digest("base64")

    // No patching required
    if (patches.length === 0) return contents

    if (!file.toLowerCase().endsWith(".png")) {
        for (const patch of patches)
            if ((await readFile(patch.original)).equals(contents))
                return patch.patched

        return contents
    }

    const cached = await checkCached(file, patchHash, cachedFile.lastmodified)
    if (cached) return cached

    Logger.log(`Need to repatch ${file}`)

    const spritesheet = await patchAsset(cacheFile, await Jimp.read(contents), patches)

    const output = spritesheet.out ? spritesheet.out : await spritesheet.sc.getBufferAsync(Jimp.MIME_PNG)
    cacheModded(file, output, patchHash, cachedFile.lastmodified)
    Logger.log(`Patching ${file} took ${Date.now() - startTime} ms`)
    return output
}

/**
 *
 * @param {string} cacheFile Cache file location
 * @property {import("jimp")} spritesheet
 * @param {PatchObject[]} patches
 */
async function patchAsset(cacheFile, spritesheet, patches) {
    const spritesheetMeta = cacheFile.replace(/\.png$/, ".json")

    patches = await Promise.all(patches.map(async p => {
        const img = await Jimp.read(p.original)
        return {
            ...p,
            w: img.getWidth(),
            h: img.getHeight(),
            imgOriginal: img
        }
    }))

    if (!await exists(spritesheetMeta)) {
        const potentionalPatches = patches.filter(patch => patch.w == spritesheet.getWidth() && patch.h == spritesheet.getHeight())
        if (potentionalPatches.length == 0) return spritesheet

        for (const { imgOriginal, patched } of potentionalPatches) {
            const diff = Jimp.diff(imgOriginal, spritesheet)
            if (diff.percent > 0.01) continue
            return { out: patched }
        }

        return { sc: spritesheet}
    }

    const meta = JSON.parse(await readFile(spritesheetMeta))

    for (const {frame: {x, y, w, h}} of Object.values(meta.frames)) {
        if (patches.length == 0) break

        const potentionalPatches = patches.filter(patch => patch.w == w && patch.h == h)
        if (potentionalPatches.length == 0) continue

        // Clone takes quite a while
        const toReplace = spritesheet.clone().crop(x, y, w, h)

        for (const [k, patchInfo] of Object.entries(patches)) {
            if (!potentionalPatches.includes(patchInfo)) continue
            let { imgOriginal, patched } = patchInfo

            const diff = Jimp.diff(imgOriginal, toReplace)
            if (diff.percent > 0.01) continue
            patches.splice(k, 1)

            spritesheet.mask(new Jimp(w, h, 0x0), x, y).composite(await Jimp.read(patched), x, y)
            break
        }
    }

    return { sc: spritesheet}
}

module.exports = { patch, reloadModCache }
