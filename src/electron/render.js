/* eslint-disable no-undef */
const { remote, ipcRenderer } = require ("electron")

ipcRenderer.on("update", (e, message) => update(message))
ipcRenderer.on("recent", (e, message) => {
    recent = []
    log.innerHTML = ""
    message.reverse().forEach(m => update(m))
})
ipcRenderer.on("config", (e, message) => {
    updateConfig(message)
})

/**
 * Handle a message
 * @param {[Date, import("../proxy/ipc").UpdateTypes, ...]} message Update message
 */
function update(message) {
    const messageDate = message.shift()
    const messageType = message.shift()

    switch(messageType) {
        case "error":
        case "log":
            addLog(messageType, messageDate, message)
            break
        case "stats":
            updateStats(message.shift())
            break
    }
}

let recent = []
const log = document.getElementById("log")
/**
 * Add a log element to log
 * @param {"error"|"log"} messageType Type of message, determinates color
 * @param {Date} messageDate Date of message
 * @param {any[]} message Rest of message, array gets mapped and joined together
 */
function addLog(messageType, messageDate, message) {
    recent.unshift(message)
    while (recent.length >= 50) {
        log.removeChild(log.children[log.children.length-1])
        recent.pop()
    }

    const elem = document.createElement("div")
    elem.className = `loggable ${messageType}`

    const f = (t, l = 2) => t.toString().padStart(l, "0")
    const date = document.createElement("span")
    date.className = "date"
    date.innerText = `${f(messageDate.getHours())}:${f(messageDate.getMinutes())}:${f(messageDate.getSeconds())}.${f(messageDate.getMilliseconds(), 3)}`
    elem.appendChild(date)

    const seperator = document.createElement("span")
    seperator.className = "seperator"
    seperator.innerText = ": "
    elem.appendChild(seperator)

    const msg = document.createElement("span")
    msg.className = "msg"
    msg.innerText = message.map(k => {
        switch (typeof k) {
            case "string":
            case "undefined":
                return k

            default:
                return k.toString == Object.prototype.toString ? JSON.stringify(k) : k.toString()
        }
    }).join(" ")
    elem.appendChild(msg)

    log.insertBefore(elem, log.firstChild)
}

/** @typedef {"date"|"number"|"numberH"|"bytes"|"show"} Render */
/** @type {Object.<string, Render>} */
const stats = {
    "startDate"         : "date",

    // Cache stats
    "cachedFiles"       : "number",
    "cachedSize"        : "bytes",
    "oldCache"          : "show",

    // Ignored
    "passthrough"       : "show",
    "passthroughHTTP"   : "number",
    "passthroughHTTPS"  : "number",

    // Cacher stats
    "totalHandled"      : "number",
    "inCache"           : "numberH",
    "blocked"           : "numberH",
    "failed"            : "numberH",
    "notModified"       : "numberH",
    "fetched"           : "numberH",
    "bandwidthSaved"    : "bytes",
}
/**
 * Update the value of a stat or multiple stats in UI
 * @param newStats Updated stats, <key, value> with key in stats
 */
function updateStats(newStats) {
    for(const [key, type] of Object.entries(stats)) {
        const value = newStats[key]
        if(value == undefined) continue

        switch (type) {
            case "numberH":
                document.getElementById(`${key}H`).style = value > 0 ? "" : "display:none;"
                // eslint-disable-next-line no-fallthrough
            case "number":
                document.getElementById(key).innerText = value.toLocaleString()
                break
            case "show":
                document.getElementById(key).style = value ? "" : "display:none;"
                break
            case "bytes":
                document.getElementById(key).innerText = formatBytes(value)
                break
            case "date": {
                const date = new Date(value)
                const f = (v) => v.toString().padStart(2, 0)
                document.getElementById(key).innerText = `${date.getFullYear()}-${f(date.getMonth() + 1)}-${f(date.getDate())}`
                break
            }
            default:
                document.getElementById(key).innerText = value
                break
        }
    }
}

const sizes = ["B", "KB", "MB", "GB", "TB"]
/**
 * Formats bytes to 3 digits + B/KB/MB/GB/TB
 * @param {number} size Size in bytes
 */
function formatBytes(size = 0) {
    let ind = 0
    while(size >= 1000 && ind < sizes.length - 1) {
        size /= 1024
        ind++
    }
    return `${size.toPrecision(3)} ${sizes[ind]}`
}

const settings = document.getElementById("settings")
/** @type {undefined | import("./../proxy/config").config} */
let config = undefined

/**
 * @typedef {Object} SettableInput
 * @property {"number" | "text" | "checkbox"} type
 * @property {string} title
 * @property {number} [min]
 * @property {number} [max]
 * */
/**
 * @typedef {Object} Settable
 * @property {string} label
 * @property {string} [ifEmpty]
 * @property {(value) => boolean} [verify]
 * @property {SettableInput} input
 * */
/** @type {Object.<string, Settable>} */
const settable = {
    "port": {
        "label": "Port",
        "ifEmpty": "8081",
        "input": {
            "type": "number",
            "min": 1,
            "max": 65536,
            "title": "Port used by proxy. You'll need to save and restart to apply changes."
        }
    },
    "cacheLocation": {
        "label": "Cache location",
        "ifEmpty": "default",
        "input": {
            "type": "text",
            "title": "Cache location used by proxy. You'll need to save to apply changes"
        }
    },
    "startHidden": {
        "label": "Start in system tray",
        "input": {
            "type": "checkbox",
            "title": "Whenever or not window should start in system tray. Don't forget to change before restarting"
        }
    },
    "verifyCache": {
        "label": "Automatically verify cache integrity",
        "input": {
            "type": "checkbox",
            "title": "Whenever or not the proxy should automatically save cache. You'll need to save to apply changes."
        }
    },
    "disableBrowserCache": {
        "label": "Disable browser caching",
        "input": {
            "type": "checkbox",
            "title": "Whenever or not the proxy should tell the browser to cache the files or not. You'll need to save to apply changes."
        }
    },
    "bypassGadgetUpdateCheck": {
        "label": "Bypass checking for gadget updates on gadget server",
        "input": {
            "type": "checkbox",
            "title": "Whenever or not the proxy should check for updates of files on gadget server. You'll need to save to apply changes."
        }
    },
    "gameVersionOverwrite": {
        "label": "Overwrite game version ('false' to disable)",
        "ifEmpty": "false",
        "input": {
            "type": "text",
            "title": "Overwrite game version. Entering 'false' will use cached game version. You'll need to save to apply changes"
        },
        "verify": (v) => v == "false" || v.match(/^\d\.\d\.\d\.\d\$/),
        "verifyError": "Invalid version, needs to be 'false' or X.Y.Z.A with letter being a digit"
    }
}
/**
 * Update config
 * @param {import("./../proxy/config").config} c Config file
 */
function updateConfig(c) {
    settings.innerHTML = ""
    config = c

    for (const [key, value] of Object.entries(settable)) {
        const label = document.createElement("label")
        label.innerText = `${value.label}: `
        settings.appendChild(label)
        settings.appendChild(document.createElement("br"))

        const input = document.createElement("input")
        for (const [K, V] of Object.entries(value.input))
            input[K] = V

        input.id = key
        switch(value.input.type) {
            case "checkbox":
                input.checked = config[key]
                break
            default:
                input.value = config[key]
                break
        }
        input.onchange = checkSaveable
        label.appendChild(input)
    }
}

const saveButton = document.getElementById("save")
let newConfig = config
/**
 * Check if anything needs to be saved in new config
 */
function checkSaveable() {
    newConfig = JSON.parse(JSON.stringify(config))

    let foundDifferent = false
    for (const [key, settings] of Object.entries(settable)) {
        const input = document.getElementById(key)
        let value = getValue(key, input)

        if(settings.ifEmpty !== undefined && input.value == "")
            value = input.value = newConfig[key] = settings.ifEmpty

        if(settings.verify !== undefined && !settings.verify(value)) {
            addLog("error", new Date(), [settings.verifyError])
            value = input.value = newConfig[key] = config[key]
        }

        if (value != config[key])
            foundDifferent = true

        newConfig[key] = value
    }
    saveButton.disabled = !foundDifferent
    saveButton.onclick = saveConfig

    function getValue(key, input) {
        switch (settable[key].input.type) {
            case "number":
                return +input.value
            case "checkbox":
                return input.checked
            default:
                return input.value
        }
    }
}

/**
 * Save config
 */
function saveConfig() {
    ipcRenderer.send("setConfig", newConfig)
    config = newConfig
    saveButton.disabled = true
}

for (const type of ["verifyCache", "importCache", "reloadCache"])
    document.getElementById(type).onclick = () => ipcRenderer.send(type)

ipcRenderer.send("getRecent")
ipcRenderer.send("getConfig")

document.title = `KCCacheProxy: v${remote.app.getVersion()}`
