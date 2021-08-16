"use strict";

function log(message) {
    console.log(`frida-agent: ${message}`);
}

function walk_back_oep(context, module) {
    const module_image_start = module.base;
    const module_image_end = module.base.add(module.size);
    let backtrace = Thread.backtrace(context, Backtracer.ACCURATE);
    let oep_candidate = null;
    backtrace.forEach(addr => {
        if (module_image_start.compare(addr) <= 0 && module_image_end.compare(addr) > 0) {
            oep_candidate = addr;
        }
    });
    return oep_candidate;
}

// Define available RPCs
rpc.exports = {
    setupOepTracing: function (module_name) {
        const dumped_module = Process.findModuleByName(module_name);
        if (dumped_module == null) {
            log('Invalid module specified');
            return;
        }

        log(`Setting up OEP tracing for "${module_name}"`);
        let OEPs = new Set();
        const RtlQueryPerformanceCounter = Module.findExportByName('ntdll', 'RtlQueryPerformanceCounter')
        Interceptor.attach(RtlQueryPerformanceCounter, {
            onEnter: function (_args) {
                let oep_candidate = walk_back_oep(this.context, dumped_module);
                if (oep_candidate != null) {
                    // FIXME: This assumes a `call rel32` was used.
                    oep_candidate = oep_candidate.sub(5);
                    const OEP_RVA = oep_candidate.sub(dumped_module.base);
                    const continue_event = `continue_${this.threadId}`;
                    log(`Possible OEP: ${oep_candidate} (RVA: ${OEP_RVA})`);
                    send({ 'event': 'possible OEP', 'OEP': oep_candidate, 'OEP_RVA': OEP_RVA, 'continue_event': continue_event })
                    let sync_op = recv(continue_event, function (_value) { });
                    sync_op.wait();
                    OEPs.add('' + oep_candidate);
                }
            }
        });
    },
    getArchitecture: function () { return Process.arch; },
    getPointerSize: function () { return Process.pointerSize; },
    getPageSize: function () { return Process.pageSize; },
    enumerateModuleRanges: function (module_name) {
        let ranges = Process.enumerateRangesSync("r--");
        return ranges.filter(range => {
            const module = Process.findModuleByAddress(range.base);
            return module != null && module.name.localeCompare(module_name) == 0;
        });
    },
    enumerateExportedFunctions: function () {
        const modules = Process.enumerateModules();
        let exports = [];
        modules.forEach(module => {
            exports = exports.concat(module.enumerateExports());
        });
        return exports;
    },
    readProcessMemory: function (address, size) {
        return Memory.readByteArray(ptr(address), size);
    },
    writeProcessMemory: function (address, bytes) {
        return Memory.writeByteArray(ptr(address), bytes);
    }
};
