{ pkgs, ... }:

pkgs.buildNpmPackage rec {
  pname = "omp-llmgateway";
  version = "0.2.0";

  src = ./.;

  # first-party extension — no runtime deps, only a peer dep on
  # @oh-my-pi/pi-coding-agent which omp's jiti loader supplies at runtime.
  # the lockfile has no resolved URLs, so forceEmptyCache is required.
  npmDepsHash = "sha256-xJIwWb7mKTrDSjPCb/vGp5dMN91NxuzUZNwxqhAs8YE=";
  npmFlags = [ "--legacy-peer-deps" ];
  forceEmptyCache = true;

  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall
    # standardised extension layout — install under $out/<name>/
    mkdir -p $out/${pname}
    cp -r . $out/${pname}/
    runHook postInstall
  '';

  meta = {
    description = "LLM Gateway provider for omp with auto-populating model list";
    homepage = "https://github.com/cawilliamson/omp-llmgateway";
    license = pkgs.lib.licenses.mit;
  };
}