require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

const SOLC = "0.8.26";

// Use the solc compiler from npm instead of downloading one, so builds work offline.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === SOLC) {
    const solc = require("solc");
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: SOLC,
      longVersion: solc.version().replace(".Emscripten.clang", ""),
    };
  }
  return runSuper();
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: { version: SOLC, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
};
