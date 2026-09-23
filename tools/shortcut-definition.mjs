export const shortcutFileName = "BiliCDNAuto-ConnectVPN.shortcut";

export function createConnectVpnShortcut() {
  return {
    WFWorkflowActions: [
      {
        WFWorkflowActionIdentifier: "is.workflow.actions.vpn.set",
        WFWorkflowActionParameters: {
          WFVPNOperation: "Connect",
        },
      },
    ],
    WFWorkflowClientRelease: "4.0",
    WFWorkflowClientVersion: "3100",
    WFWorkflowIcon: {
      WFWorkflowIconGlyphNumber: 59825,
      WFWorkflowIconStartColor: 4274264319,
    },
    WFWorkflowImportQuestions: [],
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowTypes: [],
  };
}
