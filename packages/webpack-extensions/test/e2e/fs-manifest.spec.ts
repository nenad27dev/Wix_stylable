import { readFileSync } from 'fs';
import { EOL } from 'os';
import { dirname, join } from 'path';
import { expect } from 'chai';
import { StylableProjectRunner } from '@stylable/e2e-test-kit';
import { ComponentsMetadata, hashContent } from '@stylable/webpack-extensions';

const project = 'manifest-plugin';
const projectDir = dirname(
    require.resolve(`@stylable/webpack-extensions/test/e2e/projects/${project}/webpack.config`)
);

describe(`${project} - fs-manifest`, () => {
    const projectRunner = StylableProjectRunner.mochaSetup(
        {
            projectDir,
            launchOptions: {
                // headless: false
            },
            configName: 'webpack.fs-manifest.config',
        },
        before,
        afterEach,
        after
    );

    it('Should generate manifest for the current build', () => {
        const assets = projectRunner.getBuildAssets();
        const manifestKey = Object.keys(assets).find((key) => key.startsWith('stylable.manifest'))!;
        const source = assets[manifestKey].source();

        const compContent = readFileSync(
            join(projectRunner.testDir, 'Button.comp.st.css'),
            'utf-8'
        );
        const commonContent = readFileSync(join(projectRunner.testDir, 'common.st.css'), 'utf-8');
        const commonHash = hashContent(commonContent);
        const compHash = hashContent(compContent);

        const fsMetadata: ComponentsMetadata = {
            name: 'manifest-plugin-test',
            version: '0.0.0-test',
            components: {
                Button: {
                    id: 'Button',
                    namespace: 'Buttoncomp1090430236',
                    stylesheetPath: `/${compHash}.st.css`,
                },
            },
            fs: {
                [`/manifest-plugin-test/index.st.css`]: {
                    content: `:import{-st-from: "/${compHash}.st.css";-st-default: Button;} .root Button{}${EOL}`,
                    metadata: {
                        namespace: 'manifest-plugin-test',
                    },
                },
                [`/${compHash}.st.css`]: {
                    content: compContent.replace('./common.st.css', `/${commonHash}.st.css`),
                    metadata: { namespace: 'Buttoncomp1090430236' },
                },
                [`/${commonHash}.st.css`]: {
                    content: commonContent,
                    metadata: { namespace: 'common911354609' },
                },
            },
            packages: {},
        };
        expect(JSON.parse(source)).to.deep.include(fsMetadata);
    });
});
