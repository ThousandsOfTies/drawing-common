// React type declarations for npm workspace compatibility
// This ensures TypeScript can compile even when @types/react is hoisted elsewhere

declare module 'react' {
    // Basic React types
    export type ReactNode =
        | React.ReactElement
        | string
        | number
        | boolean
        | null
        | undefined
        | Iterable<ReactNode>;

    export interface ReactElement<P = any, T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>> {
        type: T;
        props: P;
        key: Key | null;
    }

    export type JSXElementConstructor<P> = ((props: P) => ReactElement<any, any> | null) | (new (props: P) => Component<any, any>);

    export type Key = string | number;

    export class Component<P = {}, S = {}> {
        props: Readonly<P>;
        state: Readonly<S>;
        setState<K extends keyof S>(
            state: ((prevState: Readonly<S>, props: Readonly<P>) => Pick<S, K> | S | null) | (Pick<S, K> | S | null),
            callback?: () => void
        ): void;
        render(): ReactNode;
    }

    // Hooks
    export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
    export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];

    export function useRef<T>(initialValue: T): MutableRefObject<T>;
    export function useRef<T>(initialValue: T | null): RefObject<T>;
    export function useRef<T = undefined>(): MutableRefObject<T | undefined>;

    export function useEffect(effect: EffectCallback, deps?: DependencyList): void;
    export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: DependencyList): T;
    export function useMemo<T>(factory: () => T, deps: DependencyList | undefined): T;

    export type Dispatch<A> = (value: A) => void;
    export type SetStateAction<S> = S | ((prevState: S) => S);

    export interface MutableRefObject<T> {
        current: T;
    }

    export interface RefObject<T> {
        readonly current: T | null;
    }

    export type EffectCallback = () => (void | (() => void | undefined));
    export type DependencyList = ReadonlyArray<unknown>;
}
