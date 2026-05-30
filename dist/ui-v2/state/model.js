// Application model. Library + Project (stage rail) routes, loaded project data,
// a global Job, per-stage triage selections, a text-input modal, global
// overlays (help/settings/palette/confirm), and a transient action message.
export function initModel(config, library) {
    return {
        config,
        library,
        route: { screen: "library" },
        query: "",
        searching: false,
        selected: 0,
        project: null,
        projectLoading: false,
        job: null,
        glossarySelected: 0,
        glossaryFilter: "all",
        deferred: [],
        qaSelected: 0,
        sourceSelected: 0,
        input: null,
        overlay: null,
        message: null
    };
}
