
type Result<T> = {
    success: true
    data: T
} | {
    success: false
    message: string
};

const Result = {
    success<T>(data: T): Result<T> {
        return { success: true, data };
    },
    failure(message: string): Result<never> {
        return { success: false, message };
    }
};

export default Result;
