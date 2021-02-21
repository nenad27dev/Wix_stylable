import { Stylable } from '@stylable/core';
import { resolveNamespace } from '@stylable/node';
import { createMetadataForStylesheet } from './create-metadata-stylesheet';
import { hashContent } from './hash-content-util';
import { basename } from 'path';
import { EOL } from 'os';
import { sources } from 'webpack';
import type { Compilation, Compiler, Module } from 'webpack';
import type { ComponentsMetadata } from './component-metadata-builder';
import type { Metadata, Manifest } from './types';

const { RawSource } = sources;

export interface Options {
    outputType: 'manifest' | 'fs-manifest';
    package: { name: string; version: string };
    packageAlias: Record<string, string>;
    contentHashLength?: number;
    exposeNamespaceMapping: boolean;
    resolveNamespace(namespace: string, filePath: string): string;
    filterComponents(resourcePath: string): boolean;
    getCompId(resourcePath: string): string;
    getOutputFileName(contentHash: string): string;
}

const defaultOptions: Options = {
    package: {
        name: 'default-name',
        version: '0.0.0-default',
    },
    outputType: 'manifest',
    packageAlias: {},
    resolveNamespace,
    exposeNamespaceMapping: true,
    filterComponents(resourcePath) {
        return resourcePath.endsWith('.comp.st.css');
    },
    getCompId(resourcePath) {
        return basename(resourcePath).replace(/\.comp\.st\.css$/, '');
    },
    getOutputFileName(contentHash) {
        return `stylable.manifest.${contentHash}.json`;
    },
};

export class StylableManifestPlugin {
    private options: Options;
    constructor(options: Partial<Options> = {}) {
        this.options = Object.assign({}, defaultOptions, options);
    }
    public apply(compiler: Compiler) {
        const stylable = Stylable.create({
            projectRoot: compiler.context,
            fileSystem: {
                readlinkSync: (filePath) =>
                    (compiler.inputFileSystem as any).readlinkSync(filePath),
                statSync: (filePath) => (compiler.inputFileSystem as any).statSync(filePath),
                readFileSync: (filePath) =>
                    (compiler.inputFileSystem as any).readFileSync(filePath).toString(),
            },
            mode: compiler.options.mode === 'development' ? 'development' : 'production',
            resolveOptions: compiler.options.resolve as any /* make stylable types better */,
            resolverCache: new Map(),
            resolveNamespace: this.options.resolveNamespace,
        });

        compiler.hooks.done.tap(this.constructor.name + ' stylable.initCache', () => stylable.initCache());

        let metadata: Array<{ compId: string; metadata: Metadata }>;
        compiler.hooks.compilation.tap(this.constructor.name, (compilation) => {
            compilation.hooks.optimizeModules.tap(this.constructor.name, (modules) => {
                metadata = this.createModulesMetadata(compiler, stylable, [...modules]);
            });

            compilation.hooks.processAssets.tap(this.constructor.name, () =>
                this.emitManifest(metadata, compilation)
            );
        });
    }
    private emitManifest(
        metadata: { compId: string; metadata: Metadata }[],
        compilation: Compilation
    ) {
        const manifest = metadata.reduce<Manifest>(
            (manifest, { compId, metadata }) => {
                Object.assign(manifest.stylesheetMapping, metadata.stylesheetMapping);
                Object.assign(manifest.namespaceMapping, metadata.namespaceMapping);
                manifest.componentsEntries[compId] = metadata.entry;
                manifest.componentsIndex += `:import{-st-from: ${JSON.stringify(
                    metadata.entry
                )};-st-default: ${compId};} .root ${compId}{}${EOL}`;
                return manifest;
            },
            {
                name: this.options.package.name,
                version: this.options.package.version,
                componentsIndex: '',
                componentsEntries: {},
                stylesheetMapping: {},
                namespaceMapping: {},
            }
        );

        if (this.options.outputType === 'fs-manifest') {
            this.emitJSONAsset(
                convertToFsMetadata(manifest, this.options.packageAlias),
                compilation
            );
        } else {
            this.emitJSONAsset(manifest, compilation);
        }
    }

    private emitJSONAsset(manifest: Manifest | ComponentsMetadata, compilation: Compilation) {
        const manifestContent = JSON.stringify(manifest);

        const contentHash = hashContent(manifestContent, this.options.contentHashLength);
        compilation.emitAsset(
            this.options.getOutputFileName(contentHash),
            new RawSource(manifestContent, false)
        );
    }

    private createModulesMetadata(compiler: Compiler, stylable: Stylable, modules: Module[]) {
        const stylableComps = modules.filter((module) => {
            const resource = (module as any).resource;
            return resource && this.options.filterComponents(resource);
        });

        return stylableComps.map((module) => {
            const resource = (module as any).resource;
            const source = (compiler.inputFileSystem as any).readFileSync(resource).toString();

            return {
                compId: this.options.getCompId(resource),
                metadata: createMetadataForStylesheet(
                    stylable,
                    source,
                    resource,
                    this.options.exposeNamespaceMapping
                ),
            };
        });
    }
}

/* This supports the output of previous version of the metadata plugin */
const convertToFsMetadata = (
    manifest: Manifest,
    packages: Record<string, string>
): ComponentsMetadata => {
    const pkg = { name: manifest.name, version: manifest.version };

    const normalizedMetadata: ComponentsMetadata = {
        ...pkg,
        fs: {
            [`/${manifest.name}/index.st.css`]: {
                metadata: {
                    /* naive package name to css class might need to support more characters */
                    namespace: manifest.name.replace(/[@/]/g, '_'),
                },
                content: manifest.componentsIndex,
            },
        },
        components: {},
        packages,
    };
    Object.keys(manifest.stylesheetMapping).forEach((filePath) => {
        normalizedMetadata.fs[filePath] = {
            metadata: {
                namespace: manifest.namespaceMapping[filePath],
            },
            content: manifest.stylesheetMapping[filePath],
        };
    });
    Object.keys(manifest.componentsEntries).forEach((id) => {
        const stylesheetPath = manifest.componentsEntries[id];
        const namespace = manifest.namespaceMapping[stylesheetPath];
        normalizedMetadata.components[id] = {
            id,
            stylesheetPath,
            namespace,
        };
    });
    return normalizedMetadata;
};
