import * as core from '@actions/core'
import { mockClient } from "aws-sdk-client-mock";
import {
    GetSecretValueCommand, ListSecretsCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { run } from "../src";
import { CLEANUP_NAME } from "../src/constants";

const DEFAULT_TEST_ENV = {
    AWS_DEFAULT_REGION: 'us-east-1'
};

const smMockClient = mockClient(SecretsManagerClient);

const TEST_NAME = "test/*";

const TEST_NAME_1 = "test/one";
const SECRET_1 = '{"user": "admin", "password": "adminpw"}';

const TEST_NAME_2 = "test/two";
const SECRET_2 = '{"user": "integ", "password": "integpw"}';

const TEST_NAME_3 = "app/secret";
const ENV_NAME_3 = "SECRET_ALIAS";
const SECRET_3 = "secretString1";
const TEST_INPUT_3 = ENV_NAME_3 + "," + TEST_NAME_3;

const TEST_ARN_1 = 'arn:aws:secretsmanager:ap-south-1:123456789000:secret:test2-aBcdef';
const TEST_NAME_4 = 'arn/secret-name';
const ENV_NAME_4 = 'ARN_ALIAS';
const SECRET_4 = "secretString2";
const TEST_ARN_INPUT = ENV_NAME_4 + "," + TEST_ARN_1;

// Mock the inputs for Github action
jest.mock('@actions/core', () => {
    return {
        getMultilineInput: jest.fn((name: string, options?: core.InputOptions) =>  [TEST_NAME, TEST_INPUT_3, TEST_ARN_INPUT] ),
        getBooleanInput: jest.fn((name: string, options?: core.InputOptions) => {
            // ensure this returns false for this test suite
            if (name === 'omit-json-prefix') {
                return false;
            }
            return true;
        }),
        setFailed: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        exportVariable:  jest.fn((name: string, val: string) => process.env[name] = val),
        setSecret:  jest.fn(),
    };
});

describe('Test main action', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        smMockClient.reset();
        process.env = {...OLD_ENV, ...DEFAULT_TEST_ENV};
    });

    afterEach(() => {
        process.env = OLD_ENV;
    });

    test('Retrieves and sets the requested secrets as environment variables, parsing JSON', async () => {
        // Mock all Secrets Manager calls
        smMockClient
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_1})
            .resolves({ Name: TEST_NAME_1, SecretString: SECRET_1 })
            .on(GetSecretValueCommand, {SecretId: TEST_NAME_2 })
            .resolves({  Name: TEST_NAME_2, SecretString: SECRET_2 })
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_3 })
            .resolves({ Name: TEST_NAME_3, SecretString: SECRET_3 })
            .on(GetSecretValueCommand, { // Retrieve arn secret
                SecretId: TEST_ARN_1,
            })
            .resolves({
                Name: TEST_NAME_4,
                SecretString: SECRET_4
            })
            .on(ListSecretsCommand)
            .resolves({
                SecretList: [
                    {
                        Name: TEST_NAME_1
                    },
                    {
                        Name: TEST_NAME_2
                    }
                ]
            });

        await run();
        expect(core.exportVariable).toHaveBeenCalledTimes(7);
        expect(core.setFailed).not.toHaveBeenCalled();

        // JSON secrets should be parsed
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_ONE_USER', 'admin');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_ONE_PASSWORD', 'adminpw');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_TWO_USER', 'integ');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_TWO_PASSWORD', 'integpw');

        expect(core.exportVariable).toHaveBeenCalledWith(ENV_NAME_3, SECRET_3);
        expect(core.exportVariable).toHaveBeenCalledWith(ENV_NAME_4, SECRET_4);

        expect(core.exportVariable).toHaveBeenCalledWith(CLEANUP_NAME, JSON.stringify(['TEST_ONE_USER', 'TEST_ONE_PASSWORD', 'TEST_TWO_USER', 'TEST_TWO_PASSWORD', ENV_NAME_3, ENV_NAME_4]));
    });

    test('Fails the action when an error occurs in Secrets Manager', async () => {
        smMockClient.onAnyCommand().resolves({});

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(1);
    });

    test('Fails the action when multiple secrets exported the same variable name', async () => {
        smMockClient
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_1})
            .resolves({ Name: TEST_NAME_1, SecretString: SECRET_1 })
            .on(GetSecretValueCommand, {SecretId: TEST_NAME_2 })
            .resolves({ Name: TEST_NAME_2, SecretString: SECRET_2 })
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_3 })
            .resolves({ Name: TEST_NAME_3, SecretString: SECRET_3 })
            .on(GetSecretValueCommand, { // Retrieve arn secret
                SecretId: TEST_ARN_1,
            })
            .resolves({
                Name: TEST_NAME_4,
                SecretString: SECRET_4
            })
            .on(GetSecretValueCommand) // default
            .resolves({Name: "DefaultName", SecretString: "Default"})
            .on(ListSecretsCommand)
            .resolves({
                SecretList: [
                    {
                        Name: "TEST/SECRET/2"
                    },
                    {
                        Name: "TEST/SECRET@2"
                    }
                ]
            });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(1);
    });
});